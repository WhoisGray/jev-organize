# Security incident report INC-2026-007

**Title:** Phishing email led to one compromised mailbox (no financial loss)
**Report date:** 15 May 2026
**Prepared by:** Owen Pryce, IT & Systems Manager
**Severity:** Medium · **Status:** Closed (actions open, see section 6)
**Classification:** Confidential - IT, leadership team and Board only

## 1. Summary

A staff member in the Finance team received a phishing email that pretended to come from one of our overseas packaging suppliers. It asked us to "update remittance details" and linked to a fake sign-in page for our email system. The staff member entered their password. MFA blocked the first sign-in attempt, but the attacker then sent a second MFA request, which was approved by mistake. The attacker had access to the mailbox for 38 minutes. No payments were changed or made.

## 2. Timeline (all times BST, 14 May 2026)

- 10:12 Phishing email received by 6 staff (Finance, Operations, Purchasing).
- 10:19 Finance staff member opens the link and enters credentials.
- 10:21 First MFA prompt denied. 10:23 Second MFA prompt approved.
- 10:31 Attacker creates an inbox rule forwarding emails containing "invoice" or "bank" to an external address.
- 10:58 Frankie Lowe reports the email as phishing.
- 11:01 IT review triggered; suspicious sign-in from an unknown location found.
- 11:01 Session revoked, password reset, forwarding rule deleted.
- 11:20 All 6 recipients' accounts checked; no other compromise found.
- 14:00 Supplier contacted by phone on the number in our records; they confirmed they did not send the email.

## 3. Impact

- 1 mailbox accessed for 38 minutes. 11 emails were forwarded to the attacker, including 3 supplier invoices and 1 remittance advice.
- No bank details were changed in the finance system. No payments were made.
- Personal data exposure assessed as low (business contact details only). Not reportable to the regulator; decision recorded by the Data Protection Lead.

## 4. Root cause

- Convincing phishing email using a look-alike domain registered 2 days earlier.
- MFA "push fatigue": the user approved a second prompt they had not started.
- External auto-forwarding was allowed in the email system.

## 5. What went well

- Fast report from a colleague and a 3-minute response by IT.
- The supplier bank-detail call-back rule in the IT Security Policy (section 4) would have stopped any payment change.

## 6. Actions

| # | Action | Owner | Due | Status |
|---|---|---|---|---|
| 1 | Block automatic forwarding to external addresses | Owen Pryce | 16 May 2026 | Done |
| 2 | Switch MFA to number matching instead of simple approve/deny | Owen Pryce | 31 May 2026 | Done |
| 3 | Warn the 3 suppliers whose invoices were forwarded | Nadia Brennan | 18 May 2026 | Done |
| 4 | Extra phishing training for Finance and Purchasing | Owen Pryce | 30 June 2026 | Open |
| 5 | Report incident to the Board (risk register) | Helen Marsh | 16 July 2026 | Open |
