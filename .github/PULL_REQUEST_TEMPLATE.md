<!--
PR Template · local-first-social-network
Governed derivative of the Governed PR Framework v0.4 (J. Wright)
Full framework: github.com/jediwright/governed-pr-framework

HOW THIS WORKS
1. Declare your tier below. 2. Fill only the sections your tier requires. 3. Delete unused sections.
Tier disputes resolve UPWARD (reviewer's call wins if higher).
Changes touching a protected surface (see CONTRIBUTING.md) are automatically Critical.
No pre-cleared classes are declared in this repo yet — all changes tier normally.
This repo's review scale is S1 (solo + AI assistant) — you don't declare it here.

EMERGENCY CHANGES (live incidents, security responses): act first, then open this PR
retrospectively within 1 business day. Fill it as a Critical-tier PR with honest
after-the-fact tags. See §10.1 of the framework for the full procedure.
-->

## Change Tier
<!-- Pick ONE. Tier = how far a failure would spread, not how many lines changed.
     Low-risk  — failure would be local and visible (rename, constant, test-only change)
     Feature   — failure could spread within one area (new feature, module refactor)
     Critical  — failure could be silent or unrecoverable:
                   • anything in src/types/crossing.ts (locked schema — seam-decision session only)
                   • src/store/ydoc.ts (TrustEntry, map declarations, canCross, mutation helpers)
                   • connection/trust separation (syncStatus vs. tier / grantedBy — S4-1a)
                   • write-before-fire ordering in src/lib/relay.js
                   • yjs / y-indexeddb / ws versions; any Keyhive or Automerge package (S4-3)
                   • CONTRIBUTING.md, this template, SEAM_DECISIONS.md, KNOWN_LIMITS.md (governance configuration)
                   • crossing_intents / crossing_records, exportLocalState, relay crossing events (evidence layer)
                 Full protected-surface list: CONTRIBUTING.md -->

**Tier:** Low-risk / Feature / Critical

---

## Intent
<!-- ALL TIERS. What this changes and why — readable without opening the diff.
     Example: "Writes a CrossingIntentRecord to crossing_intents before
     sendConnectionRequest() calls socket.send(), so a dropped request leaves
     evidence of the attempt per S4-2." -->



<!-- ============ LOW-RISK PRs STOP HERE. Everything below is Feature tier and up. ============ -->

## Acceptance Criteria  <!-- Feature + Critical -->
<!-- Written BEFORE the code. Given / when / then. Point each one at where it's met.
     Example: "Given a contact with syncStatus 'synced' and grantedBy 'default',
     when canCross(contactId, 'thread-sync') runs, then it returns { ok: false }
     and a completion record with blockReason 'gate-failed-closed' is written
     → met in ydoc.ts canCross + S4-5 assertion (4)" -->

- [ ] Given … when … then … → met in: …
- [ ] Given … when … then … → met in: …

## Verification Status  <!-- Feature + Critical -->
<!-- Tag each substantive claim. The tags:
     Confirmed      — verified; say against WHAT (test run, package version) and when
     Inferred       — follows from something confirmed; state the reasoning
     Unverified     — assumed; MUST include a closure plan (what you'll watch, by when).
                      Not allowed on protected surfaces (K4).
     Time-sensitive — true now; name what will make it expire

     Note: Confirmed tags against the Y.js / y-indexeddb stack are
     Time-sensitive — package.json declares caret ranges, not exact pins. Name the
     resolved version set (package-lock.json) the claim was confirmed against. -->

| Claim | Tag | Evidence / reasoning / closure plan |
|---|---|---|
|  |  |  |

## Not in this PR
<!-- One line. What you deliberately left out, and why leaving it out is safe. -->

**Not in this PR:** … — **safe to defer because:** …

## Pre-mortem  <!-- Feature + Critical -->
<!-- Answer in writing: "It's two weeks from now and this PR caused an incident.
     What was it?"
     For gate or schema changes: consider specifically — did this let a peer's
     acceptance raise this user's trust tier? Did it silently change what the gate
     records vs. what crossing_records stores? Did it reorder write-before-fire so
     a socket.send() can happen with no intent record? Did it make the relay hold
     durable state? -->



<!-- ============ FEATURE PRs STOP HERE. Everything below is Critical tier only. ============ -->

## Convention Check  <!-- Critical -->
<!-- Link the governing document for any schema, key format, protocol, or type convention touched.
     If the convention doc does not exist yet: writing it is part of this PR.
     For changes to crossing.ts, ydoc.ts, relay.js, or relay/server.js: the governing record is
     SEAM_DECISIONS.md — link the relevant decision (S4-1 … S4-5). -->

- Convention doc(s):
- New/updated doc included in this PR (if a gap was found):

## Decision Record  <!-- Critical — only if this PR settles a question that would fail silently if wrong -->
<!-- Link a short record: context / decision / alternatives considered / consequences.
     Ordinary implementation choices that a visible later refactor could reverse don't need one.
     Changes to the gate table, the connection/trust separation, or the
     intent/completion record separation almost always need one. -->

- Decision record link:

## Boundary Questions  <!-- Critical — protected surfaces only -->
<!-- Does this change what any party can SEE, FORGE, REPLAY, or DENY?
     "No change" is a fine answer. A blank is not.
     For gate or trust-model changes: also answer — does this widen what a peer's
     act can do to this user's trust graph? Does it narrow or remove an S4-1a constraint? -->

- See:
- Forge:
- Replay:
- Deny:

## Deletion Justification  <!-- Critical — only if code is removed -->
<!-- Why did the removed code exist? If the answer is "nobody knows," that's a
     documentation gap to log under §7 of the framework — not permission to delete. -->



## Verification Chain  <!-- Critical — bug fixes only -->
<!-- "Fixed the bug" is not evidence. Show the trail. -->

- Symptom (precise):
- Root cause (confirmed, not guessed):
- How it was confirmed (hypothesis → minimal test → result):

---

## Review  <!-- completed by the reviewer, not the author -->

- **Tier declaration matches the diff:** <!-- yes | disputed → resolves upward -->
- **Reviewed outside the authoring context via:** <!-- maintainer review | separate session vs. spec (solo) -->
- **Automated checks (npm run build — tsc green; S4-5 two-tab checklist for Phase 4 PRs):** <!-- green | bypass declared above with reason -->
- **No Unverified tags on protected surfaces:** <!-- confirmed | n/a -->

**Reviewer scope** <!-- required on Feature+ at this scale -->
- Approved (what I evaluated):
- Not evaluated (outside my domain):

**Block note** <!-- anyone may block any PR; overriding a block requires written justification here -->

---
<!-- Before merging:
     · Rebased across a package.json change? Confirmed tags on stack-dependent claims are stale — re-verify.
     · PR open past 14 days? Re-verify Confirmed tags; don't just rebase.
     · Gate or trust-model changes: confirm peer acceptance still lands at tier 'discoverable'
       with grantedBy 'default' and does not trigger sync, or that any change to it has passed
       the full S4-1a boundary-questions block above. -->
