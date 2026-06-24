package main

import "testing"

func TestExtractBearerTokenFromHeader(t *testing.T) {
	token, err := extractBearerToken("Authorization: Bearer abc.def_123\r\nAccept: application/json")
	if err != nil {
		t.Fatal(err)
	}
	if token != "abc.def_123" {
		t.Fatalf("unexpected token %q", token)
	}
}

func TestManualIDHubContextFromAPIURL(t *testing.T) {
	base, tenant, err := manualIDHubContext(
		"https://lbenson-idhub.us004-rapididentity.com/idhub/",
		"https://lbenson-idhub.us004-rapididentity.com/v1/tenants/lbenson/sources?page[size]=20",
	)
	if err != nil {
		t.Fatal(err)
	}
	if base != "https://lbenson-idhub.us004-rapididentity.com" {
		t.Fatalf("unexpected base %q", base)
	}
	if tenant != "lbenson" {
		t.Fatalf("unexpected tenant %q", tenant)
	}
}

func TestManualIDHubContextFromTenantURL(t *testing.T) {
	base, tenant, err := manualIDHubContext("https://lbenson-idhub.us004-rapididentity.com/idhub/", "")
	if err != nil {
		t.Fatal(err)
	}
	if base != "https://lbenson-idhub.us004-rapididentity.com" {
		t.Fatalf("unexpected base %q", base)
	}
	if tenant != "lbenson" {
		t.Fatalf("unexpected tenant %q", tenant)
	}
}
