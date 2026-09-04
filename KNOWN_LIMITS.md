# Known Limits

This file lists design choices in SocialPings that are intentional for the current
version but that a reader might reasonably mistake for gaps. Each entry says what the
limit is, why it exists, and what the planned upgrade path is.

Last updated: 2026-09-02 (before Phase 4 build)

---

## 1. Trust tiers are enforced by convention, not by cryptography

**What the limit is.** When you assign a contact a trust tier (for example, "close"
or "acquaintance"), that assignment is stored in your local data and the app checks it
before any connection or sync goes through the relay. The check is real and it fails
closed: if there is no valid trust entry for a contact, the relay operation does not
run. But the check is performed by application code following an agreed rule. Nothing
cryptographic prevents a modified client from skipping it.

**Why it exists.** A social ping between two people does not carry the same stakes as,
say, an employment record. Cryptographic capability enforcement adds a substantial
dependency (an alpha-stage library plus delegation machinery) that would slow the build
and complicate the code well beyond what the current trust model needs. The crossing
records that every relay operation writes to your device already give you a verifiable
evidence trail without that machinery.

**Upgrade path.** Keyhive-based capability enforcement is the named post-MVP path. In
that model the trust tier becomes a signed capability rather than a stored field, so
the relay and the peer can verify the grant without trusting the client's code. Because
all trust data already lives on your device in a local-first format, this upgrade can
be added without migrating data away from you.

---

## 2. The relay's handle registry is ephemeral

**What the limit is.** The relay keeps an in-memory list of which `@handle` is
currently connected. When the relay restarts, that list is empty and is rebuilt as
clients reconnect. There is no server-side database of handles. This means that, at
the moment of a restart, two different people could in principle claim the same handle
until the original owner reconnects, and the relay has no permanent record to arbitrate
the conflict.

**Why it exists.** SocialPings is built on the principle that the relay facilitates a
connection and then exits. It stores no content and no relationship data. A persistent
handle database would be the first piece of durable server-side state, and it would
make the platform the authority on who you are — the exact thing the architecture is
designed to avoid. Rebuilding the registry from reconnecting clients is the smallest
amount of server state that still lets people find each other. This is a chosen
tradeoff, not an oversight.

**Upgrade path.** Cryptographic handle binding is the named post-MVP path. Each handle
would be tied to a key pair held on your device; the relay would verify a signature at
connection time instead of relying on first-come registration. The registry can stay
ephemeral under that model — it just becomes unforgeable. Until then, your handle is
yours by convention and by continued presence, not by proof.

---

*Systems of Thought / J. Wright. AI-collaborative synthesis, human authorial
responsibility held by J. Wright.*
