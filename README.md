# Funder (Metanet Client) — Minimal SPV via Atomic BEEF & Deposit Slips

**Live demo:** [https://funder.metanet.app](https://funder.metanet.app)

This app does one thing ruthlessly well: move money using **Atomic BEEF** instead of chain-scanning or trusted “message box” servers. It gives you a practical, minimal SPV flow you can operate over any channel—Slack DMs, QR, email, snail mail, even carrier pigeon (RFC 1149 nod). It supports **legacy P2PKH addresses** on purpose, because base58 + P2PKH is still a valid and useful way to lock funds in a post-indexer world.

The result: you can receive and send funds between **Metanet** and **non-Metanet** entities, to and from **airgapped** systems, and between **two parties who don’t trust a message box**—without chain scanning, without relying on third parties, and without lying to yourself about privacy.

---

## What this is

Funder is a BRC100 apps that:

* **Generates one-off “Deposit Slips”.** Each slip derives a fresh P2PKH address off a prefix/suffix using `counterparty=anyone`. It’s meant to be **single-use**. Once a deposit is internalized, the slip is **marked USED** on-chain. Don’t reuse slips unless you want to destroy your privacy footprint.
* **Produces Atomic BEEF when you send.** Enter an address and amount, the app builds a transaction and gives you the **Atomic BEEF** to hand to the recipient. They can internalize it—no scanning.
* **Consumes Atomic BEEF when you receive.** Paste an Atomic BEEF that pays your slip’s address, and the wallet **internalizes** it. No WoC, no crawler, no external trust.
* **Works offline-friendly.** The data you pass around is the transaction itself. You can move it over any medium you want.

If your friend’s wallet won’t provide Atomic BEEF yet, that’s their problem. Falling back to a chain-scanning service is possible but is a **last resort** with **bad privacy**. Push the ecosystem forward.

---

## Why you might want this

* Move funds to/from **airgapped** systems without building RPC bridges to indexers.
* Exchange money between **two Metanet users** who want **zero third-party intermediaries**.
* Send money from a “normal” wallet to a Metanet user while preserving the option to avoid scanning.
* Produce a clean, **single-use** receive address (“Deposit Slip”) that’s bound to a specific context (a person, a delivery, an invoice) and can be archived once consumed.

---

## Core ideas

**Atomic BEEF** is the message. When you pay someone, give them the BEEF. When you receive money, you internalize BEEF that pays your slip’s P2PKH.

**Deposit Slips** are one-off receive descriptors:

* They package a P2PKH **address** and human instructions.
* They embed derivation hints as `prefix`/`suffix` tied to `counterparty=anyone`.
* They are **single-use**: after internalizing a payment that hits the slip’s address, the slip is updated to `used=1` on-chain.

**Privacy is your job.** Reusing a slip links flows and makes graph analysis trivial. The UI lets you reuse (because reality), but it warns you loudly and sorts used slips to the bottom. Don’t reuse unless you accept the consequences.

---

## App flow

### Receiving (Incoming tab)

1. Generate a **Deposit Slip**. It shows a fresh address from your derivation.
2. Give the **address** to the sender.
3. The sender creates and returns **Atomic BEEF** that pays that address (they can use Funder’s Outgoing tab).
4. Paste the **Atomic BEEF** into the slip and click **Deposit to Wallet**. Your wallet internalizes it; the slip is then **marked USED**.
5. You can **download** a `.txt` file for a slip any time; downloading a used slip is allowed but discouraged.

### Sending (Outgoing tab)

1. Enter the recipient’s **address** and **amount**.
2. Click **Send** to generate **Atomic BEEF** for that transaction.
3. Hand the **Atomic BEEF** to the recipient. They internalize it—no external indexers needed.

### If a wallet doesn’t provide Atomic BEEF

* Right now, some wallets (e.g., **RockWallet**, as of this writing) may not return Atomic BEEF when sending to an address. If they add it, use it—privacy and scalability improve immediately.
* Without BEEF, people turn to chain-scanning services (e.g., [mountaintops.net](https://mountaintops.net) / WoC). That works, but you bleed privacy and reintroduce third-party trust. Treat it as a **very last resort**.

---

## Deposit Slip Protocol (DSP) — what we store/show

Each Slip (Metanet Client view) contains:

* Public key (derived via `counterparty=anyone` from prefix/suffix, implicitly represented by the Address / P2PKH hash)
* Public key hash (implied by Address)
* P2PKH script (standard)
* Base58 address (displayed)
* Human-readable instructions (downloadable `.txt`)

Private record may include:

* Private key (if you own the spend path)
* Key derivation info: prefix/suffix used with `counterparty=anyone`

In the Metanet Client:

* We store the **key derivation prefix/suffix**.
* All slips use **counterparty=anyone**.
* Derivation info is stored in a **basket**.
* When internalized, the slip is **consumed** and re-emitted as **used**.

This app is **not** the “Vault” (airgapped) UI, but it’s compatible with vault workflows. A vault can generate a slip and receive BEEF via any medium. Metanet users can do the same with this app.

---

## Example slip export (`.txt`)

```
BSV Deposit Slip (Metanet Client)
------------------------
Memo:          Receive Key
Used:          No

Public key:    (derived via counterparty=anyone from prefix/suffix)
Pubkey hash:   (embedded in Address)
P2PKH Script:  (standard pay-to-pubkey-hash for Address)
Address:       1KQTzuj7rQ689VBcUkSNvw9RNKDKQfcN8V

Derivation Prefix (base64): <prefix>
Derivation Suffix (base64): <suffix>

Created/Exported At: 2025-10-07T17:21:29.582Z

Instructions:
- Use the Funder app to create an Atomic BEEF that PAYS THIS ADDRESS.
- Paste that Atomic BEEF in Metanet Client to deposit to this slip.
- Once deposited, this slip will be marked as USED. Do not reuse slips.
```

If a slip is already used, the file name appends `_USED` and the file includes a hard warning.

---

## Tech stack & notable bits

* React + TypeScript (Vite)
* Styling is lean: gradient background, glass card, focus-visible states, no horizontal jitter on mobile
* `@bsv/sdk`:

  * `WalletClient`, `ProtoWallet('anyone')`, `PushDrop`, `Transaction`, `PublicKey`, `Random`, `Utils`, `P2PKH`
  * Basket: `"deposit slips"`
  * `listOutputs({ include: 'entire transactions', includeCustomInstructions: true })`
  * `createAction`, `signAction`, `internalizeAction`
  * `PushDrop.lock/unlock` to create/consume the slip token and re-emit with `used=1`
* “Outgoing” tab **only** produces BEEF and broadcasts the TX. You have to give it to the recipient yourself, that's by design.

---

## Getting started (dev)

You need Node 18+.

```bash
git clone https://github.com/p2ppsr/funding-util.git
cd funding-util/frontend
npm install
npm run start
```

Build for production:

```bash
npm run build
```

You can deploy it with CARS / BRC102, so there's a `deployment-info.json` if you're into that.

---

## UX guardrails (what the UI enforces)

* **Two tabs**: Outgoing (send → get BEEF) and Incoming (slips → paste BEEF).
* **Slips sorted** with **unused first**, **used last**.
* **Warnings** before downloading or depositing to a **used** slip.
* **Copy** buttons and **`.txt` export** for slips.
* **Spinner/disabled** states to prevent double submits.
* **Atom boxes wrap and scroll** so long BEEF never wrecks your layout.

---

## Limitations and realities

* If the sender won’t give you Atomic BEEF, you can’t internalize in a trustless way. Your fallback is a chain-scanning service (privacy hit). Funder doesn’t sugarcoat that.
* This is a **minimal** SPV pattern: it’s intentionally manual. You can automate around it later, but the primitive is the BEEF itself.

---

## Contributing

File issues and PRs that stick to the core philosophy: **move value with BEEF, avoid scanning, don’t hide the privacy tradeoffs.** Keep UI changes tight—no overflow, no jitter, no fragile CSS.

---

## FAQ

**Can I reuse a deposit slip?**
You can, the UI allows it, but don’t. Reuse links flows and hurts privacy. The app warns you and pushes used slips to the bottom to discourage bad habits.

**What if my sender’s wallet doesn’t return BEEF?**
Tell them to use tools that do. Otherwise your only option is a chain scanner (last resort, privacy loss).

**Why base58/P2PKH in 2025?**
Because it’s still a valid locking scheme and plays nicely with SPV where the transaction artifact (BEEF) is the portable message. Modern doesn’t mean “depend on a surveillance indexer.”

---

## License

Open BSV