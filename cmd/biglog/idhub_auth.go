package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"
)

const (
	idhubConnectTimeout = 10 * time.Minute
	idhubRefreshSkew    = 30 * time.Second
)

type idhubResource struct {
	Type       string         `json:"type,omitempty"`
	ID         string         `json:"id,omitempty"`
	Attributes map[string]any `json:"attributes,omitempty"`
}

type idhubAuthSession struct {
	ID               string
	TenantURL        string
	StartURL         string
	BrowserPath      string
	State            string
	Message          string
	LastError        string
	Connected        bool
	TenantID         string
	IDHubAPIBase     string
	CatalogAPIBase   string
	ExternalClientID string
	AuthHost         string
	ClientID         string
	RedirectURI      string
	AccessToken      string
	RefreshToken     string
	AccessTokenExp   time.Time
	Sources          []idhubResource
	CreatedAt        time.Time
	UpdatedAt        time.Time

	mu              sync.RWMutex
	cleanupOnce     sync.Once
	browserCmd      *exec.Cmd
	browserPort     int
	browserTargetID string
	browserUserDir  string
}

type idhubStatusResponse struct {
	ID               string          `json:"id"`
	Connected        bool            `json:"connected"`
	State            string          `json:"state"`
	Message          string          `json:"message,omitempty"`
	LastError        string          `json:"lastError,omitempty"`
	TenantURL        string          `json:"tenantUrl,omitempty"`
	StartURL         string          `json:"startUrl,omitempty"`
	BrowserPath      string          `json:"browserPath,omitempty"`
	TenantID         string          `json:"tenantId,omitempty"`
	IDHubAPIBase     string          `json:"idhubApiBase,omitempty"`
	CatalogAPIBase   string          `json:"catalogApiBase,omitempty"`
	ExternalClientID string          `json:"externalClientId,omitempty"`
	ClientID         string          `json:"clientId,omitempty"`
	AuthHost         string          `json:"authHost,omitempty"`
	ExpiresAt        string          `json:"expiresAt,omitempty"`
	SourceCount      int             `json:"sourceCount,omitempty"`
	Sources          []idhubResource `json:"sources,omitempty"`
	CreatedAt        string          `json:"createdAt,omitempty"`
	UpdatedAt        string          `json:"updatedAt,omitempty"`
}

type idhubConnectStartRequest struct {
	TenantURL string `json:"tenantUrl"`
}

type idhubBootstrapInfo struct {
	TenantID   string `json:"tenantId"`
	ModuleInfo struct {
		IDHub struct {
			LcsDomain               string `json:"lcsDomain"`
			CatalogDomain           string `json:"catalogDomain"`
			LcsExternalAuthClientID string `json:"lcsExternalAuthClientId"`
		} `json:"idhub"`
	} `json:"moduleInfo"`
}

type idhubClientMetadata struct {
	Data struct {
		Attributes struct {
			Host     string `json:"host"`
			ClientID string `json:"client-id"`
		} `json:"attributes"`
	} `json:"data"`
}

type idhubTokenResponse struct {
	AccessToken     string `json:"access_token"`
	RefreshToken    string `json:"refresh_token"`
	ExpiresIn       int    `json:"expires_in"`
	TokenType       string `json:"token_type"`
	Error           string `json:"error"`
	ErrorDesc       string `json:"error_description"`
	RefreshTokenOut string `json:"refresh_token,omitempty"`
}

type idhubSourceList struct {
	Data []idhubResource `json:"data"`
}

type idhubProxyContext struct {
	Base   string
	Tenant string
	Auth   string
}

var (
	idhubSessionsMu sync.RWMutex
	idhubSessions   = map[string]*idhubAuthSession{}
)

func idhubConnectStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	defer r.Body.Close()

	var req idhubConnectStartRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}

	startURL, err := normalizeTenantURL(req.TenantURL)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	sess := &idhubAuthSession{
		ID:        newOpaqueID(),
		TenantURL: startURL,
		StartURL:  startURL,
		State:     "launching",
		Message:   "Opening a browser window for RI / IDHub sign-in…",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	idhubSessionsMu.Lock()
	idhubSessions[sess.ID] = sess
	idhubSessionsMu.Unlock()

	go sess.runBrowserConnect()

	writeJSON(w, sess.status())
}

func idhubConnectStatus(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		http.Error(w, "id param required", http.StatusBadRequest)
		return
	}
	sess, ok := getIDHubSession(id)
	if !ok {
		http.Error(w, "IDHub session not found", http.StatusNotFound)
		return
	}
	writeJSON(w, sess.status())
}

func idhubConnectDisconnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		http.Error(w, "POST or DELETE only", http.StatusMethodNotAllowed)
		return
	}
	id := strings.TrimSpace(r.URL.Query().Get("id"))
	if id == "" {
		http.Error(w, "id param required", http.StatusBadRequest)
		return
	}
	sess, ok := getIDHubSession(id)
	if !ok {
		http.Error(w, "IDHub session not found", http.StatusNotFound)
		return
	}
	sess.closeBrowserResources()
	idhubSessionsMu.Lock()
	delete(idhubSessions, id)
	idhubSessionsMu.Unlock()
	writeJSON(w, map[string]any{"ok": true})
}

func idhubSources(w http.ResponseWriter, r *http.Request) {
	sess, err := requireIDHubSession(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := sess.fetchSources(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	sess.mu.RLock()
	data := append([]idhubResource(nil), sess.Sources...)
	sess.mu.RUnlock()
	writeJSON(w, idhubSourceList{Data: data})
}

func requireIDHubSession(r *http.Request) (*idhubAuthSession, error) {
	id := strings.TrimSpace(r.URL.Query().Get("session"))
	if id == "" {
		return nil, errors.New("session param required")
	}
	sess, ok := getIDHubSession(id)
	if !ok {
		return nil, errors.New("IDHub session not found")
	}
	return sess, nil
}

func getIDHubSession(id string) (*idhubAuthSession, bool) {
	idhubSessionsMu.RLock()
	defer idhubSessionsMu.RUnlock()
	sess, ok := idhubSessions[id]
	return sess, ok
}

func (s *idhubAuthSession) status() idhubStatusResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := idhubStatusResponse{
		ID:               s.ID,
		Connected:        s.Connected,
		State:            s.State,
		Message:          s.Message,
		LastError:        s.LastError,
		TenantURL:        s.TenantURL,
		StartURL:         s.StartURL,
		BrowserPath:      s.BrowserPath,
		TenantID:         s.TenantID,
		IDHubAPIBase:     s.IDHubAPIBase,
		CatalogAPIBase:   s.CatalogAPIBase,
		ExternalClientID: s.ExternalClientID,
		ClientID:         s.ClientID,
		AuthHost:         s.AuthHost,
		SourceCount:      len(s.Sources),
		Sources:          append([]idhubResource(nil), s.Sources...),
		CreatedAt:        s.CreatedAt.Format(time.RFC3339),
		UpdatedAt:        s.UpdatedAt.Format(time.RFC3339),
	}
	if !s.AccessTokenExp.IsZero() {
		out.ExpiresAt = s.AccessTokenExp.Format(time.RFC3339)
	}
	return out
}

func (s *idhubAuthSession) runBrowserConnect() {
	ctx, cancel := context.WithTimeout(context.Background(), idhubConnectTimeout)
	defer cancel()

	browserPath, err := findBrowserExecutable()
	if err != nil {
		s.fail(err)
		return
	}
	port, err := reserveDebugPort()
	if err != nil {
		s.fail(fmt.Errorf("failed to reserve a browser debug port: %w", err))
		return
	}
	userDir, err := os.MkdirTemp("", "biglog-idhub-browser-*")
	if err != nil {
		s.fail(fmt.Errorf("failed to create a browser profile: %w", err))
		return
	}
	cmd, err := launchBrowser(browserPath, port, userDir)
	if err != nil {
		_ = os.RemoveAll(userDir)
		s.fail(err)
		return
	}

	s.mu.Lock()
	s.BrowserPath = browserPath
	s.browserCmd = cmd
	s.browserPort = port
	s.browserUserDir = userDir
	s.UpdatedAt = time.Now()
	s.mu.Unlock()

	exitCh := make(chan error, 1)
	go func() {
		exitCh <- cmd.Wait()
	}()

	s.setProgress("waiting_browser", "Finish RI / Okta auth in the browser window. If you land in RapidIdentity first, click the IDHub app tile.")

	if err := waitForDevTools(ctx, port); err != nil {
		s.closeBrowserResources()
		s.fail(fmt.Errorf("browser did not start cleanly: %w", err))
		return
	}

	target, created, err := chooseDevToolsTarget(ctx, port, s.StartURL)
	if err != nil {
		s.closeBrowserResources()
		s.fail(fmt.Errorf("failed to open the tenant URL: %w", err))
		return
	}

	s.mu.Lock()
	s.browserTargetID = target.ID
	s.UpdatedAt = time.Now()
	s.mu.Unlock()

	cdp, err := newCDPClient(ctx, target.WebSocketDebuggerURL)
	if err != nil {
		s.closeBrowserResources()
		s.fail(fmt.Errorf("failed to attach to the browser window: %w", err))
		return
	}
	defer cdp.Close()

	if err := cdp.Call(ctx, "Page.enable", map[string]any{}, nil); err != nil {
		s.closeBrowserResources()
		s.fail(fmt.Errorf("failed to enable browser page events: %w", err))
		return
	}
	if err := cdp.Call(ctx, "Network.enable", map[string]any{}, nil); err != nil {
		s.closeBrowserResources()
		s.fail(fmt.Errorf("failed to enable browser network events: %w", err))
		return
	}
	if !created {
		_ = cdp.Call(ctx, "Page.navigate", map[string]any{"url": s.StartURL}, nil)
	}

	if err := s.captureIDHubSession(ctx, cdp, exitCh); err != nil {
		s.closeBrowserResources()
		s.fail(err)
		return
	}

	if err := s.fetchSources(context.Background()); err != nil {
		s.setConnected("Connected to IDHub. Source loading failed, but you can retry.", err.Error())
	} else {
		s.setConnected("Connected to IDHub. Sources are ready.", "")
	}

	s.closeBrowserResources()
}

type trackedRequest struct {
	URL       string
	PostData  string
	TrackBody bool
}

type networkRequestEvent struct {
	RequestID string `json:"requestId"`
	Request   struct {
		URL      string         `json:"url"`
		Method   string         `json:"method"`
		Headers  map[string]any `json:"headers"`
		PostData string         `json:"postData"`
	} `json:"request"`
}

type networkResponseEvent struct {
	RequestID string `json:"requestId"`
	Response  struct {
		URL    string  `json:"url"`
		Status float64 `json:"status"`
	} `json:"response"`
}

type networkLoadingFinished struct {
	RequestID string `json:"requestId"`
}

func (s *idhubAuthSession) captureIDHubSession(ctx context.Context, cdp *cdpClient, exitCh <-chan error) error {
	tracked := map[string]*trackedRequest{}

	for {
		if s.ready() {
			return nil
		}
		select {
		case err := <-exitCh:
			if s.ready() {
				return nil
			}
			if err != nil {
				return fmt.Errorf("browser closed before IDHub connected: %w", err)
			}
			return errors.New("browser closed before IDHub connected")
		case <-ctx.Done():
			if s.ready() {
				return nil
			}
			return errors.New("timed out waiting for RI / IDHub authentication")
		case ev, ok := <-cdp.Events():
			if !ok {
				if s.ready() {
					return nil
				}
				return errors.New("lost connection to the authentication browser")
			}
			switch ev.Method {
			case "Network.requestWillBeSent":
				var req networkRequestEvent
				if json.Unmarshal(ev.Params, &req) != nil {
					continue
				}
				s.observeRequest(req, tracked)
			case "Network.responseReceived":
				var resp networkResponseEvent
				if json.Unmarshal(ev.Params, &resp) != nil {
					continue
				}
				if t, ok := tracked[resp.RequestID]; ok {
					t.TrackBody = true
					t.URL = resp.Response.URL
				}
			case "Network.loadingFinished":
				var finished networkLoadingFinished
				if json.Unmarshal(ev.Params, &finished) != nil {
					continue
				}
				tr, ok := tracked[finished.RequestID]
				if !ok || !tr.TrackBody {
					delete(tracked, finished.RequestID)
					continue
				}
				body, err := cdp.GetResponseBody(ctx, finished.RequestID)
				delete(tracked, finished.RequestID)
				if err != nil {
					continue
				}
				if err := s.observeResponse(tr.URL, body); err != nil {
					return err
				}
			}
		}
	}
}

func (s *idhubAuthSession) observeRequest(req networkRequestEvent, tracked map[string]*trackedRequest) {
	rawURL := req.Request.URL
	track := false

	switch {
	case strings.Contains(rawURL, "/api/rest/bootstrapInfo"):
		track = true
		s.setProgressIfIdle("waiting_idhub", "RapidIdentity session detected. Waiting for IDHub to finish signing in…")
	case strings.Contains(rawURL, "/oauth2/token"):
		track = true
		s.captureTokenRequest(rawURL, req.Request.PostData)
		s.setProgressIfIdle("waiting_token", "Completing the IDHub token exchange…")
	case strings.Contains(rawURL, "/v1/tenants/") && strings.Contains(rawURL, "/clients/"):
		track = true
		s.captureAPIURL(rawURL)
	case strings.Contains(rawURL, "/v1/tenants/") && (strings.Contains(rawURL, "/sources") || strings.Contains(rawURL, "/sinks") || strings.Contains(rawURL, "/jobs")):
		track = true
		s.captureAPIURL(rawURL)
		if auth := headerString(req.Request.Headers, "Authorization"); auth != "" {
			s.captureBearer(auth)
		}
	}

	if track {
		tracked[req.RequestID] = &trackedRequest{URL: rawURL, PostData: req.Request.PostData}
	}
}

func (s *idhubAuthSession) observeResponse(rawURL string, body []byte) error {
	switch {
	case strings.Contains(rawURL, "/api/rest/bootstrapInfo"):
		return s.applyBootstrapInfo(body)
	case strings.Contains(rawURL, "/oauth2/token"):
		return s.applyTokenResponse(body)
	case strings.Contains(rawURL, "/v1/tenants/") && strings.Contains(rawURL, "/clients/"):
		return s.applyClientMetadata(body)
	case strings.Contains(rawURL, "/v1/tenants/") && strings.Contains(rawURL, "/sources"):
		return s.applySourceList(body)
	default:
		return nil
	}
}

func (s *idhubAuthSession) ready() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.AccessToken != "" && s.TenantID != "" && s.IDHubAPIBase != ""
}

func (s *idhubAuthSession) setProgress(state, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Connected || s.State == "error" {
		return
	}
	s.State = state
	s.Message = message
	s.LastError = ""
	s.UpdatedAt = time.Now()
}

func (s *idhubAuthSession) setProgressIfIdle(state, message string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Connected || s.State == "error" {
		return
	}
	if s.State == state && s.Message == message {
		return
	}
	s.State = state
	s.Message = message
	s.UpdatedAt = time.Now()
}

func (s *idhubAuthSession) setConnected(message, warning string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Connected = true
	s.State = "connected"
	s.Message = message
	s.LastError = warning
	s.UpdatedAt = time.Now()
}

func (s *idhubAuthSession) fail(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Connected = false
	s.State = "error"
	s.Message = "IDHub connection failed."
	if err != nil {
		s.LastError = err.Error()
	}
	s.UpdatedAt = time.Now()
}

func (s *idhubAuthSession) captureTokenRequest(rawURL, postData string) {
	u, err := url.Parse(rawURL)
	if err == nil && u.Host != "" {
		s.mu.Lock()
		s.AuthHost = u.Host
		s.UpdatedAt = time.Now()
		s.mu.Unlock()
	}
	if vals, err := url.ParseQuery(postData); err == nil {
		s.mu.Lock()
		if v := strings.TrimSpace(vals.Get("client_id")); v != "" {
			s.ClientID = v
		}
		if v := strings.TrimSpace(vals.Get("redirect_uri")); v != "" {
			s.RedirectURI = v
		}
		s.UpdatedAt = time.Now()
		s.mu.Unlock()
	}
}

func (s *idhubAuthSession) captureAPIURL(rawURL string) {
	base, tenant := parseTenantAPIURL(rawURL)
	if base == "" && tenant == "" {
		return
	}
	s.mu.Lock()
	if base != "" {
		s.IDHubAPIBase = base
	}
	if tenant != "" {
		s.TenantID = tenant
	}
	s.UpdatedAt = time.Now()
	s.mu.Unlock()
}

func (s *idhubAuthSession) captureBearer(auth string) {
	auth = strings.TrimSpace(auth)
	if strings.HasPrefix(strings.ToLower(auth), "bearer ") {
		auth = strings.TrimSpace(auth[7:])
	}
	if auth == "" {
		return
	}
	s.mu.Lock()
	if s.AccessToken == "" {
		s.AccessToken = auth
		if s.AccessTokenExp.IsZero() {
			s.AccessTokenExp = time.Now().Add(45 * time.Minute)
		}
	}
	s.UpdatedAt = time.Now()
	s.mu.Unlock()
}

func (s *idhubAuthSession) applyBootstrapInfo(body []byte) error {
	var payload idhubBootstrapInfo
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil
	}
	s.mu.Lock()
	if payload.TenantID != "" {
		s.TenantID = payload.TenantID
	}
	if payload.ModuleInfo.IDHub.LcsDomain != "" {
		s.IDHubAPIBase = strings.TrimRight(payload.ModuleInfo.IDHub.LcsDomain, "/")
	}
	if payload.ModuleInfo.IDHub.CatalogDomain != "" {
		s.CatalogAPIBase = strings.TrimRight(payload.ModuleInfo.IDHub.CatalogDomain, "/")
	}
	if payload.ModuleInfo.IDHub.LcsExternalAuthClientID != "" {
		s.ExternalClientID = payload.ModuleInfo.IDHub.LcsExternalAuthClientID
	}
	s.UpdatedAt = time.Now()
	s.mu.Unlock()
	return nil
}

func (s *idhubAuthSession) applyClientMetadata(body []byte) error {
	var payload idhubClientMetadata
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil
	}
	s.mu.Lock()
	if payload.Data.Attributes.Host != "" {
		s.AuthHost = payload.Data.Attributes.Host
	}
	if payload.Data.Attributes.ClientID != "" {
		s.ClientID = payload.Data.Attributes.ClientID
	}
	s.UpdatedAt = time.Now()
	s.mu.Unlock()
	return nil
}

func (s *idhubAuthSession) applyTokenResponse(body []byte) error {
	var payload idhubTokenResponse
	if err := json.Unmarshal(body, &payload); err != nil {
		return fmt.Errorf("failed to parse the IDHub token response: %w", err)
	}
	if payload.Error != "" {
		msg := payload.Error
		if payload.ErrorDesc != "" {
			msg = payload.ErrorDesc
		}
		return fmt.Errorf("IDHub token exchange failed: %s", msg)
	}
	if payload.AccessToken == "" {
		return errors.New("IDHub token exchange did not return an access token")
	}
	s.mu.Lock()
	s.AccessToken = payload.AccessToken
	if payload.RefreshToken != "" {
		s.RefreshToken = payload.RefreshToken
	}
	if payload.RefreshTokenOut != "" {
		s.RefreshToken = payload.RefreshTokenOut
	}
	if payload.ExpiresIn > 0 {
		s.AccessTokenExp = time.Now().Add(time.Duration(payload.ExpiresIn) * time.Second)
	} else if s.AccessTokenExp.IsZero() {
		s.AccessTokenExp = time.Now().Add(45 * time.Minute)
	}
	s.UpdatedAt = time.Now()
	s.mu.Unlock()
	return nil
}

func (s *idhubAuthSession) applySourceList(body []byte) error {
	var payload idhubSourceList
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil
	}
	if len(payload.Data) == 0 {
		return nil
	}
	s.mu.Lock()
	s.Sources = append([]idhubResource(nil), payload.Data...)
	s.UpdatedAt = time.Now()
	s.mu.Unlock()
	return nil
}

func (s *idhubAuthSession) proxyContext(ctx context.Context) (idhubProxyContext, error) {
	if err := s.ensureFreshToken(ctx); err != nil {
		return idhubProxyContext{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.IDHubAPIBase == "" || s.TenantID == "" || s.AccessToken == "" {
		return idhubProxyContext{}, errors.New("IDHub session is not connected")
	}
	return idhubProxyContext{
		Base:   strings.TrimRight(s.IDHubAPIBase, "/"),
		Tenant: s.TenantID,
		Auth:   bearerValue(s.AccessToken),
	}, nil
}

func (s *idhubAuthSession) ensureFreshToken(ctx context.Context) error {
	s.mu.RLock()
	token := s.AccessToken
	expiresAt := s.AccessTokenExp
	refresh := s.RefreshToken
	host := s.AuthHost
	clientID := s.ClientID
	s.mu.RUnlock()

	if token != "" && (expiresAt.IsZero() || time.Until(expiresAt) > idhubRefreshSkew) {
		return nil
	}
	if refresh == "" || host == "" || clientID == "" {
		if token != "" {
			return nil
		}
		return errors.New("IDHub authentication expired. Reconnect to IDHub.")
	}

	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("client_id", clientID)
	form.Set("refresh_token", refresh)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+host+"/oauth2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("failed to refresh the IDHub token: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(body))
		if msg == "" {
			msg = resp.Status
		}
		return fmt.Errorf("failed to refresh the IDHub token: %s", msg)
	}
	if err := s.applyTokenResponse(body); err != nil {
		return err
	}
	return nil
}

func (s *idhubAuthSession) fetchSources(ctx context.Context) error {
	proxy, err := s.proxyContext(ctx)
	if err != nil {
		return err
	}
	upstream := fmt.Sprintf("%s/v1/tenants/%s/sources", proxy.Base, url.PathEscape(proxy.Tenant))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, upstream, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", proxy.Auth)
	req.Header.Set("Accept", "application/json,text/plain")

	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("failed to load IDHub sources: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(body))
		if msg == "" {
			msg = resp.Status
		}
		return fmt.Errorf("failed to load IDHub sources: %s", msg)
	}
	if err := s.applySourceList(body); err != nil {
		return err
	}
	return nil
}

func (s *idhubAuthSession) closeBrowserResources() {
	s.cleanupOnce.Do(func() {
		s.mu.Lock()
		cmd := s.browserCmd
		port := s.browserPort
		targetID := s.browserTargetID
		userDir := s.browserUserDir
		s.browserCmd = nil
		s.browserPort = 0
		s.browserTargetID = ""
		s.browserUserDir = ""
		s.UpdatedAt = time.Now()
		s.mu.Unlock()

		if port != 0 && targetID != "" {
			_, _ = http.Get(fmt.Sprintf("http://127.0.0.1:%d/json/close/%s", port, url.PathEscape(targetID)))
		}
		if cmd != nil && cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		if userDir != "" {
			_ = os.RemoveAll(userDir)
		}
	})
}

func resolveIDHubProxyContext(r *http.Request) (idhubProxyContext, error) {
	if sessionID := strings.TrimSpace(r.URL.Query().Get("session")); sessionID != "" {
		sess, ok := getIDHubSession(sessionID)
		if !ok {
			return idhubProxyContext{}, errors.New("IDHub session not found")
		}
		return sess.proxyContext(r.Context())
	}

	base, derivedTenant, err := normalizeIDHubBase(r.URL.Query().Get("base"))
	if err != nil {
		return idhubProxyContext{}, err
	}
	tenant := strings.TrimSpace(r.URL.Query().Get("tenant"))
	if tenant == "" {
		tenant = derivedTenant
	}
	if base == "" || tenant == "" {
		return idhubProxyContext{}, errors.New("base and tenant are required")
	}
	auth, err := getAuth(r)
	if err != nil {
		return idhubProxyContext{}, err
	}
	return idhubProxyContext{Base: base, Tenant: tenant, Auth: auth}, nil
}

func normalizeIDHubBase(raw string) (string, string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", "", errors.New("base is required")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", "", errors.New("invalid IDHub base URL")
	}
	tenant := ""
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	for i := 0; i+2 < len(parts); i++ {
		if parts[i] == "v1" && parts[i+1] == "tenants" {
			tenant = parts[i+2]
			break
		}
	}
	return strings.TrimRight(fmt.Sprintf("%s://%s", schemeFor(u.Scheme), u.Host), "/"), tenant, nil
}

func normalizeTenantURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", errors.New("tenant URL is required")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", errors.New("invalid tenant URL")
	}
	u.RawQuery = ""
	u.Fragment = ""
	if u.Path == "" {
		u.Path = "/"
	}
	return strings.TrimRight(u.String(), "/"), nil
}

func parseTenantAPIURL(raw string) (string, string) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" {
		return "", ""
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	for i := 0; i+2 < len(parts); i++ {
		if parts[i] == "v1" && parts[i+1] == "tenants" {
			return strings.TrimRight(fmt.Sprintf("%s://%s", schemeFor(u.Scheme), u.Host), "/"), parts[i+2]
		}
	}
	return strings.TrimRight(fmt.Sprintf("%s://%s", schemeFor(u.Scheme), u.Host), "/"), ""
}

func schemeFor(s string) string {
	if s == "http" || s == "https" {
		return s
	}
	return "https"
}

func bearerValue(token string) string {
	token = strings.TrimSpace(token)
	if strings.HasPrefix(strings.ToLower(token), "bearer ") {
		return token
	}
	if token == "" {
		return ""
	}
	return "Bearer " + token
}

func headerString(headers map[string]any, key string) string {
	for k, v := range headers {
		if strings.EqualFold(k, key) {
			return strings.TrimSpace(fmt.Sprint(v))
		}
	}
	return ""
}

func newOpaqueID() string {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err == nil {
		return hex.EncodeToString(buf)
	}
	return fmt.Sprintf("idhub-%d", time.Now().UnixNano())
}

func reserveDebugPort() (int, error) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port, nil
}

func findBrowserExecutable() (string, error) {
	if env := strings.TrimSpace(os.Getenv("BIGLOG_BROWSER_PATH")); env != "" {
		if _, err := os.Stat(env); err == nil {
			return env, nil
		}
	}
	candidates := []string{
		"msedge", "microsoft-edge", "google-chrome", "chrome", "chromium", "chromium-browser",
	}
	for _, name := range candidates {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}
	var paths []string
	switch runtime.GOOS {
	case "windows":
		paths = append(paths,
			filepath.Join(os.Getenv("ProgramFiles"), "Google", "Chrome", "Application", "chrome.exe"),
			filepath.Join(os.Getenv("ProgramFiles(x86)"), "Google", "Chrome", "Application", "chrome.exe"),
			filepath.Join(os.Getenv("ProgramFiles"), "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(os.Getenv("ProgramFiles(x86)"), "Microsoft", "Edge", "Application", "msedge.exe"),
		)
	case "darwin":
		paths = append(paths,
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
		)
	default:
		paths = append(paths,
			"/usr/bin/google-chrome",
			"/usr/bin/chromium",
			"/usr/bin/chromium-browser",
			"/usr/bin/microsoft-edge",
			"/snap/bin/chromium",
		)
	}
	for _, path := range paths {
		if path == "" {
			continue
		}
		if _, err := os.Stat(path); err == nil {
			return path, nil
		}
	}
	return "", errors.New("no Chrome, Chromium, or Edge browser was found. Install one or set BIGLOG_BROWSER_PATH.")
}

func launchBrowser(browserPath string, port int, userDir string) (*exec.Cmd, error) {
	args := []string{
		fmt.Sprintf("--remote-debugging-port=%d", port),
		"--remote-debugging-address=127.0.0.1",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-default-apps",
		"--disable-popup-blocking",
		"--new-window",
		"--window-size=1280,900",
		"--user-data-dir=" + userDir,
		"about:blank",
	}
	if runtime.GOOS == "linux" && os.Geteuid() == 0 {
		args = append(args, "--no-sandbox")
	}
	cmd := exec.Command(browserPath, args...)
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("failed to launch the browser: %w", err)
	}
	return cmd, nil
}

func waitForDevTools(ctx context.Context, port int) error {
	client := &http.Client{Timeout: 2 * time.Second}
	url := fmt.Sprintf("http://127.0.0.1:%d/json/version", port)
	for {
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		resp, err := client.Do(req)
		if err == nil {
			_, _ = io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return nil
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
}

type devToolsTarget struct {
	ID                   string `json:"id"`
	Type                 string `json:"type"`
	URL                  string `json:"url"`
	WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
}

func chooseDevToolsTarget(ctx context.Context, port int, startURL string) (devToolsTarget, bool, error) {
	if tgt, err := createDevToolsTarget(ctx, port, startURL); err == nil && tgt.WebSocketDebuggerURL != "" {
		return tgt, true, nil
	}
	targets, err := listDevToolsTargets(ctx, port)
	if err != nil {
		return devToolsTarget{}, false, err
	}
	for _, tgt := range targets {
		if tgt.Type == "page" && tgt.WebSocketDebuggerURL != "" {
			return tgt, false, nil
		}
	}
	return devToolsTarget{}, false, errors.New("no browser page targets were available")
}

func createDevToolsTarget(ctx context.Context, port int, startURL string) (devToolsTarget, error) {
	endpoint := fmt.Sprintf("http://127.0.0.1:%d/json/new?%s", port, url.QueryEscape(startURL))
	methods := []string{http.MethodPut, http.MethodGet}
	client := &http.Client{Timeout: 5 * time.Second}
	for _, method := range methods {
		req, _ := http.NewRequestWithContext(ctx, method, endpoint, nil)
		resp, err := client.Do(req)
		if err != nil {
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			continue
		}
		var tgt devToolsTarget
		if err := json.Unmarshal(body, &tgt); err == nil && tgt.WebSocketDebuggerURL != "" {
			return tgt, nil
		}
	}
	return devToolsTarget{}, errors.New("failed to create a browser tab")
}

func listDevToolsTargets(ctx context.Context, port int) ([]devToolsTarget, error) {
	endpoint := fmt.Sprintf("http://127.0.0.1:%d/json/list", port)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	resp, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("DevTools returned %s", resp.Status)
	}
	var targets []devToolsTarget
	if err := json.Unmarshal(body, &targets); err != nil {
		return nil, err
	}
	return targets, nil
}

type wsClient struct {
	conn net.Conn
	br   *bufio.Reader
	mu   sync.Mutex
}

func dialWS(ctx context.Context, rawURL string) (*wsClient, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	host := u.Host
	if !strings.Contains(host, ":") {
		if u.Scheme == "wss" {
			host += ":443"
		} else {
			host += ":80"
		}
	}
	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", host)
	if err != nil {
		return nil, err
	}
	keyBytes := make([]byte, 16)
	if _, err := rand.Read(keyBytes); err != nil {
		_ = conn.Close()
		return nil, err
	}
	key := base64.StdEncoding.EncodeToString(keyBytes)
	req := fmt.Sprintf("GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n", u.RequestURI(), u.Host, key)
	if _, err := io.WriteString(conn, req); err != nil {
		_ = conn.Close()
		return nil, err
	}
	br := bufio.NewReader(conn)
	status, err := br.ReadString('\n')
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	if !strings.Contains(status, "101") {
		_ = conn.Close()
		return nil, fmt.Errorf("websocket upgrade failed: %s", strings.TrimSpace(status))
	}
	headers := map[string]string{}
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			_ = conn.Close()
			return nil, err
		}
		line = strings.TrimSpace(line)
		if line == "" {
			break
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) == 2 {
			headers[strings.ToLower(strings.TrimSpace(parts[0]))] = strings.TrimSpace(parts[1])
		}
	}
	want := base64.StdEncoding.EncodeToString(sha1Digest(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	if headers["sec-websocket-accept"] != want {
		_ = conn.Close()
		return nil, errors.New("websocket handshake failed")
	}
	return &wsClient{conn: conn, br: br}, nil
}

func sha1Digest(s string) []byte {
	h := sha1.New()
	_, _ = h.Write([]byte(s))
	return h.Sum(nil)
}

func (w *wsClient) Close() error {
	return w.conn.Close()
}

func (w *wsClient) WriteText(text string) error {
	payload := []byte(text)
	w.mu.Lock()
	defer w.mu.Unlock()

	var frame bytes.Buffer
	frame.WriteByte(0x81)
	length := len(payload)
	maskBit := byte(0x80)
	switch {
	case length < 126:
		frame.WriteByte(maskBit | byte(length))
	case length <= math.MaxUint16:
		frame.WriteByte(maskBit | 126)
		var b [2]byte
		binary.BigEndian.PutUint16(b[:], uint16(length))
		frame.Write(b[:])
	default:
		frame.WriteByte(maskBit | 127)
		var b [8]byte
		binary.BigEndian.PutUint64(b[:], uint64(length))
		frame.Write(b[:])
	}
	mask := make([]byte, 4)
	_, _ = rand.Read(mask)
	frame.Write(mask)
	masked := make([]byte, len(payload))
	for i := range payload {
		masked[i] = payload[i] ^ mask[i%4]
	}
	frame.Write(masked)
	_, err := w.conn.Write(frame.Bytes())
	return err
}

func (w *wsClient) writeControl(opcode byte, payload []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	header := []byte{0x80 | opcode, byte(len(payload))}
	_, err := w.conn.Write(append(header, payload...))
	return err
}

func (w *wsClient) ReadMessage() (byte, []byte, error) {
	var fragments [][]byte
	var opcode byte
	for {
		h1, err := w.br.ReadByte()
		if err != nil {
			return 0, nil, err
		}
		h2, err := w.br.ReadByte()
		if err != nil {
			return 0, nil, err
		}
		fin := h1&0x80 != 0
		frameOp := h1 & 0x0F
		masked := h2&0x80 != 0
		length := uint64(h2 & 0x7F)
		switch length {
		case 126:
			var b [2]byte
			if _, err := io.ReadFull(w.br, b[:]); err != nil {
				return 0, nil, err
			}
			length = uint64(binary.BigEndian.Uint16(b[:]))
		case 127:
			var b [8]byte
			if _, err := io.ReadFull(w.br, b[:]); err != nil {
				return 0, nil, err
			}
			length = binary.BigEndian.Uint64(b[:])
		}
		var mask [4]byte
		if masked {
			if _, err := io.ReadFull(w.br, mask[:]); err != nil {
				return 0, nil, err
			}
		}
		data := make([]byte, length)
		if _, err := io.ReadFull(w.br, data); err != nil {
			return 0, nil, err
		}
		if masked {
			for i := range data {
				data[i] ^= mask[i%4]
			}
		}
		switch frameOp {
		case 0x8:
			return 0x8, data, io.EOF
		case 0x9:
			_ = w.writeControl(0xA, data)
			continue
		case 0xA:
			continue
		case 0x1, 0x0:
			if frameOp != 0x0 {
				opcode = frameOp
			}
			fragments = append(fragments, data)
			if fin {
				return opcode, bytes.Join(fragments, nil), nil
			}
		default:
			if fin {
				return frameOp, data, nil
			}
		}
	}
}

type cdpMessage struct {
	ID     int             `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type cdpClient struct {
	ws      *wsClient
	events  chan cdpMessage
	pending map[int]chan cdpMessage
	nextID  int
	mu      sync.Mutex
}

func newCDPClient(ctx context.Context, wsURL string) (*cdpClient, error) {
	ws, err := dialWS(ctx, wsURL)
	if err != nil {
		return nil, err
	}
	c := &cdpClient{
		ws:      ws,
		events:  make(chan cdpMessage, 1024),
		pending: map[int]chan cdpMessage{},
	}
	go c.readLoop()
	return c, nil
}

func (c *cdpClient) Close() error {
	return c.ws.Close()
}

func (c *cdpClient) Events() <-chan cdpMessage {
	return c.events
}

func (c *cdpClient) readLoop() {
	defer close(c.events)
	for {
		opcode, payload, err := c.ws.ReadMessage()
		if err != nil {
			return
		}
		if opcode != 0x1 {
			continue
		}
		var msg cdpMessage
		if err := json.Unmarshal(payload, &msg); err != nil {
			continue
		}
		if msg.ID != 0 {
			c.mu.Lock()
			ch := c.pending[msg.ID]
			delete(c.pending, msg.ID)
			c.mu.Unlock()
			if ch != nil {
				ch <- msg
			}
			continue
		}
		c.events <- msg
	}
}

func (c *cdpClient) Call(ctx context.Context, method string, params any, out any) error {
	c.mu.Lock()
	c.nextID++
	id := c.nextID
	ch := make(chan cdpMessage, 1)
	c.pending[id] = ch
	c.mu.Unlock()

	raw, _ := json.Marshal(struct {
		ID     int    `json:"id"`
		Method string `json:"method"`
		Params any    `json:"params,omitempty"`
	}{ID: id, Method: method, Params: params})
	if err := c.ws.WriteText(string(raw)); err != nil {
		return err
	}
	select {
	case msg := <-ch:
		if msg.Error != nil {
			return fmt.Errorf("%s: %s", method, msg.Error.Message)
		}
		if out != nil {
			return json.Unmarshal(msg.Result, out)
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (c *cdpClient) GetResponseBody(ctx context.Context, requestID string) ([]byte, error) {
	var res struct {
		Body          string `json:"body"`
		Base64Encoded bool   `json:"base64Encoded"`
	}
	if err := c.Call(ctx, "Network.getResponseBody", map[string]any{"requestId": requestID}, &res); err != nil {
		return nil, err
	}
	if res.Base64Encoded {
		return base64.StdEncoding.DecodeString(res.Body)
	}
	return []byte(res.Body), nil
}
