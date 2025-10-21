# PasteBEEF!

**Live app:** [https://beef.bsv.tools](https://beef.bsv.tools)

PasteBEEF is a focused utility for working with BSV **BEEF** payloads. Paste any full or Atomic BEEF bundle and the app will break it down, surface transaction metrics, let you merge additional payloads, export atomic artifacts, and push the transaction to the network. It is built for people moving real value with the BSV SDK and who need quick visibility into what a BEEF contains before they broadcast or archive it.

---

## Feature Highlights

* **Instant parsing** – Detects hex, base64, or UTF-8 BEEF strings and renders a transaction list with sizes, dependencies, and aggregate stats.
* **Actionable metrics** – Shows total transactions, BUMPs, max dependency depth, and byte sizes so you can gauge completeness before signing or sending.
* **Atomic exports** – Download the full BEEF, the selected transaction as raw hex, or an Atomic BEEF artifact for hand-off to another wallet.
* **Merge tooling** – Combine multiple BEEF bundles, automatically de-dupe shared ancestors, and recompute metrics in one click.
* **Built-in broadcasters** – Broadcast a selected transaction through WhatsOnChain or any Teranode/ARC endpoints you control.
* **Developer-friendly UX** – Lightweight React + TypeScript interface with copy helpers, reset flows, and detailed error surfacing.

---

## Live Deployment

PasteBEEF is deployed at **https://beef.bsv.tools**. The live build is published with Open BSV licensing and powered by the same frontend contained in this repository.

---

## Local Development

### Prerequisites

* Node.js 20 or newer
* npm (ships with Node)

### Get the code

Clone the repository and move into the project directory:

```bash
git clone https://github.com/p2ppsr/PasteBEEF
cd pastebeef
```

### Frontend (Vite dev server)

```bash
cd frontend
npm install
npm run dev
```

The dev server prints a local URL (default `http://localhost:5173`). Paste a BEEF payload into the textarea to start exploring. Hot Module Reloading is enabled for rapid iteration.

### Building for production

```bash
npm run build
```

Artifacts land in `frontend/dist/`. You can preview the static build locally with:

```bash
npm run preview
```

### Optional: CARS deployment helpers

The repository includes a root-level package with `@bsv/cars-cli` and metadata in `deployment-info.json`. If you publish via BSV CARS/BRC-102, install dependencies at the repo root and use your existing deployment workflow. No additional configuration files are required for the frontend.

---

## Project Layout

* `frontend/src/main.tsx` – React application containing all PasteBEEF UI logic, metrics, exports, and broadcast hooks.
* `frontend/vite.config.ts` – Vite configuration for development and production bundling.
* `deployment-info.json` – Helper metadata for CARS deployments (optional).

---

## Broadcaster Configuration

The default broadcaster targets WhatsOnChain on the selected network. Teranode and ARC options are included as examples; replace the placeholder URLs with infrastructure you operate. Broadcasting returns the raw response JSON, which you can copy directly from the UI.

---

## License

**Open BSV** © 2025 P2PPSR
