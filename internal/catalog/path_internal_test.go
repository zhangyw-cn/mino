package catalog

import "testing"

func TestNormalizeRelBackslashHandling(t *testing.T) {
	cases := []struct {
		name                 string
		input                string
		backslashIsSeparator bool
		want                 string
	}{
		{"windows separator", `notes\a.html`, true, "notes/a.html"},
		{"unix filename", `notes\a.html`, false, `notes\a.html`},
		{"windows traversal", `notes\..\..\a.html`, true, ""},
		{"unix leading backslash", `\a.html`, false, `\a.html`},
		{"slashes unaffected", "notes/a.html", false, "notes/a.html"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeRel(tc.input, tc.backslashIsSeparator)
			if tc.want == "" {
				if err == nil {
					t.Fatalf("normalizeRel(%q) = %q, want error", tc.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalizeRel(%q): %v", tc.input, err)
			}
			if got != tc.want {
				t.Fatalf("normalizeRel(%q) = %q, want %q", tc.input, got, tc.want)
			}
		})
	}
}
