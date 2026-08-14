# Security Policy

## No secrets in this repository

This repository must never contain, in any commit, branch, issue, or PR:

- API keys or tokens
- WABA (WhatsApp Business API) credentials
- Commerce-provider credentials (Ticimax, IdeaSoft, or any other provider)
- Database credentials or connection strings containing credentials
- Real customer PII, including real customer data used as test fixtures

Use placeholder/example values only, clearly marked as such, in any documentation or configuration examples.

## Accidental secret exposure

If a secret is accidentally committed:

1. Treat the credential as compromised immediately — do not merely delete the file in a later commit.
2. Rotate/revoke the exposed credential at the provider immediately.
3. Escalate to the AI Commerce Brain and repository owner without delay.
4. Fail closed: any workflow, integration, or automation that depended on the exposed credential must be treated as untrusted until rotation is confirmed.

## Vulnerability / security escalation path

Report suspected vulnerabilities or security-relevant defects to the repository owner and the AI Commerce Brain directly. Do not open a public issue describing an unpatched vulnerability.
