# Daily Store Settlement Reconciliation Engine — AI Agent Backend

## 1. System Objective

The **Store Settlement Reconciliation Agent** is an automated backend financial auditing engine designed to extract, interpret, cross-validate, and standardize physical financial figures from heterogeneous, unstructured end-of-day store closing reports.

### Key Problem Solved
Retail stores, food & beverage outlets, and franchises traditionally conclude daily operations by generating physical daily settlement sheets. These reports are often:
- **Handwritten or hybrid documents** containing ink-written totals alongside pasted thermal POS credit card slips.
- **Prone to arithmetic errors** introduced by on-site store managers (e.g., mismatching summary totals vs. column details).
- **Subject to ambiguous categorization**, such as itemized petty cash expenses (e.g., porter charges, cleaning, refreshments) erroneously aggregated on top of summary expense entries (double-counting).
- **Vulnerable to transcription lag and errors** when manually keyed into centralized enterprise ERP or reconciliation systems.

The AI Agent automates visual document analysis (OCR + spatial multi-modal reasoning), enforces domain-specific accounting heuristics, eliminates double-counting, computes independent mathematical checks, and returns machine-parsable, structured financial records.

---

## 2. Architecture & Integrations (Tools & APIs)

```
                       +------------------------------------------+
                       |           Client Ingestion Layer         |
                       |    (Base64 Image Streams / Multipart)    |
                       +--------------------+---------------------+
                                            |
                                            v
+-----------------------------------------------------------------------------------+
| Express.js Server Runtime (Node.js / TypeScript)                                  |
|                                                                                   |
|  +---------------------+    +-------------------------+    +-------------------+  |
|  | Large Payload Body  | -> | ConcurrencyLimiter      | -> | Multi-Model       |  |
|  | Parser (JSON 50MB)  |    | (Queue + Rate Throttler)|    | Resiliency Loop   |  |
|  +---------------------+    +-------------------------+    +---------+---------+  |
|                                                                      |            |
+----------------------------------------------------------------------|------------+
                                                                       v
                                                 +----------------------------------+
                                                 | @google/genai SDK                |
                                                 | (Gemini Multimodal Models)       |
                                                 | - Structured Schema Enforcement  |
                                                 | - Model Rotation & Fallbacks     |
                                                 +----------------------------------+
```

### Internal Services & Dependencies

1. **Express.js API Framework (`server.ts`)**
   - Serves as the high-throughput HTTP backend hosting extraction routes (`/api/extract-report`) and service telemetry (`/api/health`).
   - Configured with `cors()` for cross-origin access and `express.json({ limit: "50mb" })` to handle high-resolution image uploads.

2. **Concurrency & Rate-Limiting Subsystem (`ConcurrencyLimiter`)**
   - In-memory stateful promise queue governing concurrent execution against upstream AI inference pipelines.
   - Restricts active execution slots (`maxConcurrency: 1`) with deterministic inter-call cooldown delays (`minDelayMs: 2000`) to respect API rate limits (Requests Per Minute / Tokens Per Minute).

3. **Google GenAI SDK (`@google/genai`)**
   - Directly interfaces with Google's multimodal Gemini foundation models.
   - Provides native schema enforcement using `Type.OBJECT`, `Type.NUMBER`, and `Type.STRING`, returning deterministic JSON structures via constrained decoding (`responseMimeType: "application/json"`).

4. **Model Tier Rotation & Resiliency Engine**
   - Implements automated failover across model candidates:
     - `gemini-3.5-flash`
     - `gemini-2.5-flash`
     - `gemini-flash-latest`
     - `gemini-3.1-flash-lite`
   - Incorporates automated retry loops (up to 8 attempts) with adaptive exponential backoffs and response header parsing (`retryDelay`).

---

## 3. Input Specification

### Endpoint: `POST /api/extract-report`

Receives raw encoded images representing physical settlement sheets, handwritten ledgers, or POS receipt composites.

#### Request Headers
```http
Content-Type: application/json
```

#### Request Payload Schema
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "ExtractReportRequest",
  "type": "object",
  "properties": {
    "base64Image": {
      "type": "string",
      "description": "Base64-encoded image string. Supports raw base64 or Data URI format (data:image/jpeg;base64,...)."
    }
  },
  "required": ["base64Image"],
  "additionalProperties": false
}
```

#### Payload Constraints & Ingestion Rules
- **Maximum Payload Size:** 50 Megabytes.
- **Accepted Image Formats:** JPEG, PNG, WEBP, HEIC (converted to standard Base64 image payload prior to transmission).
- **Sanitization:** Strips Data URI prefixes (e.g., `data:image/jpeg;base64,`) dynamically to obtain pure binary base64 string buffers.

---

## 4. Analysis & Core Processing Logic

```
   [POST /api/extract-report]
                |
                v
   +----------------------------+
   | Validate Payload & API Key |
   +--------------+-------------+
                  |
                  v
   +----------------------------+
   | Sanitize Base64 Image Data |
   +--------------+-------------+
                  |
                  v
   +-------------------------------------------------------+
   | Enqueue in ConcurrencyLimiter (Throttled Token Window)|
   +--------------+----------------------------------------+
                  |
                  v
   +-------------------------------------------------------+
   | Execute Multi-Attempt Resiliency Loop (Up to 8 cycles)|
   |  - Model Candidate Selection (Round-Robin Fallback)   |
   |  - Injection of Audit Heuristics Prompt               |
   |  - Enforce Typed Output Schema                        |
   +--------------+----------------------------------------+
                  |
        +---------+---------+
        |                   |
  [Success: JSON]    [Error: 429/503/404/Quota]
        |                   |
        v                   v
   +------------+    +--------------------------------+
   | Parse &    |    | Extract Retry Delay / Backoff  |
   | Return 200 |    | Rotate Model -> Next Attempt   |
   +------------+    +--------------------------------+
```

### Step-by-Step Execution Lifecycle

1. **Payload Ingestion & Sanitation**
   - The backend validates the presence of `base64Image` and server-side environment credentials (`GEMINI_API_KEY`).
   - The payload string is split at the comma boundary to extract raw Base64 image data for the Gemini SDK `inlineData` part.

2. **Concurrency Gating**
   - The extraction task is passed to `geminiLimiter.run()`.
   - If a concurrent extraction is active, incoming calls are held in an asynchronous queue. A mandatory cooldown of 2,000ms is enforced between successive executions to avoid bursting upstream quotas.

3. **Domain-Specific Cognitive Heuristics (Prompt Architecture)**
   The agent executes the vision model with specific auditing heuristics:
   - **The "Expense" Rule (Anti-Double-Counting):**
     - Identifies high-level summary expense lines (e.g., `Expense: 900`).
     - Explicitly ignores right-hand column sub-breakdowns (e.g., `Tea: 40`, `Porter: 860`) when a summarized total is present, eliminating duplicate summation.
   - **The "Cash" Rule:**
     - Differentiates physical cash on hand (`Cash`, `Cash in Hand`, `By Cash`) from aggregated cash collections or floating funds.
   - **Independent Component Calculation:**
     - The agent extracts primitive values for each payment channel: `cashCount`, `expenses`, `cardMachineTotal`, `upiMachineTotal`, and `sodexoTotal`.
     - It computes the internal sum:
       $$\text{Calculated Total} = \text{cashCount} + \text{expenses} + \text{cardMachineTotal} + \text{upiMachineTotal} + \text{sodexoTotal}$$
     - It compares this against any manually written total on the sheet. If an arithmetic error exists in the manager's handwriting, the agent **trusts the discrete components** and overrides the incorrect written sum.
   - **Handling Blank/Unmarked Fields:**
     - Missing or unpopulated ledger slots (e.g., `Staff Advance`, `Vendor Payment`) default to `0`.
   - **Occlusion Handling & Thermal Slip Precedence:**
     - When printed bank settlement slips cover handwritten portions, values on the thermal slip take precedence for that payment category.

4. **Schema Enforcement & Constrained Decoding**
   The SDK enforces JSON Schema compliance via native API parameters:
   ```typescript
   config: {
     responseMimeType: "application/json",
     responseSchema: {
       type: Type.OBJECT,
       properties: {
         extractedStoreName: { type: Type.STRING },
         extractedDate: { type: Type.STRING },
         cashCount: { type: Type.NUMBER },
         expenses: { type: Type.NUMBER },
         upiMachineTotal: { type: Type.NUMBER },
         cardMachineTotal: { type: Type.NUMBER },
         sodexoTotal: { type: Type.NUMBER },
         totalSales: { type: Type.NUMBER },
       },
       required: ["cashCount", "expenses", "upiMachineTotal", "cardMachineTotal", "sodexoTotal"],
     }
   }
   ```

5. **Fault-Tolerant Retry & Model Failover Engine**
   - If an invocation encounters transient infrastructure failures (`503 UNAVAILABLE`, `429 RESOURCE_EXHAUSTED`, `404 NOT_FOUND`, `high demand`, `quota exceeded`), the engine catches the error, parses recommended retry intervals (`retry in X.Xs`), implements backoff delays, rotates to the next model in `modelsToTry`, and retries.

---

## 5. Output Specification

### Success Response (`HTTP 200 OK`)

The backend yields a clean, strongly-typed JSON object containing the normalized financial extraction results.

#### Response JSON Schema
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "PhysicalDataExtractionResponse",
  "type": "object",
  "properties": {
    "extractedStoreName": {
      "type": "string",
      "description": "Normalized name of the retail store or branch extracted from document header/stamp."
    },
    "extractedDate": {
      "type": "string",
      "format": "date",
      "description": "ISO 8601 formatted date (YYYY-MM-DD) found on the settlement sheet."
    },
    "cashCount": {
      "type": "number",
      "description": "Total physical cash in hand before operational expense deductions."
    },
    "expenses": {
      "type": "number",
      "description": "Total operational expenses / petty cash payouts approved for the shift."
    },
    "upiMachineTotal": {
      "type": "number",
      "description": "Digital UPI / QR code payment settlement total."
    },
    "cardMachineTotal": {
      "type": "number",
      "description": "POS EDC terminal settlement total for Credit / Debit cards."
    },
    "sodexoTotal": {
      "type": "number",
      "description": "Total voucher / meal pass settlements (e.g., Sodexo, Pluxee)."
    },
    "totalSales": {
      "type": "number",
      "description": "Audited sum of all physical payment components: (cashCount + expenses + upiMachineTotal + cardMachineTotal + sodexoTotal)."
    }
  },
  "required": [
    "cashCount",
    "expenses",
    "upiMachineTotal",
    "cardMachineTotal",
    "sodexoTotal",
    "totalSales"
  ]
}
```

#### Example Output Payload
```json
{
  "extractedStoreName": "Koramangala 5th Block",
  "extractedDate": "2026-06-23",
  "cashCount": 1420.00,
  "expenses": 900.00,
  "upiMachineTotal": 12450.50,
  "cardMachineTotal": 8320.00,
  "sodexoTotal": 450.00,
  "totalSales": 23540.50
}
```

### Error Responses

#### 1. Invalid Input (`HTTP 400 Bad Request`)
```json
{
  "error": "No image data provided"
}
```

#### 2. Upstream Infrastructure / Quota Exhaustion (`HTTP 500 Internal Server Error`)
```json
{
  "error": "Gemini API rate limit or quota exceeded for this API key. Please wait ~1 minute or configure a paid API key in Settings."
}
```
*(or detailed error diagnostics if unrecoverable error occurs)*

---

## 6. Technical Summary for Maintenance & Operations

| Metric / Parameter | Value / Configuration |
| :--- | :--- |
| **Backend Runtime** | Node.js with TypeScript (`tsx` in dev, `esbuild` CommonJS bundle in prod) |
| **Ingress Port & Binding** | `0.0.0.0:3000` |
| **Concurrency Ceiling** | `1` active model inference call per instance |
| **Inter-Request Throttle** | `2000ms` fixed buffer window |
| **Max Retry Cycles** | `8` attempts with dynamic backoff |
| **Model Rotation Pool** | `gemini-3.5-flash` $\rightarrow$ `gemini-2.5-flash` $\rightarrow$ `gemini-flash-latest` $\rightarrow$ `gemini-3.1-flash-lite` |
| **Decoding Constraint** | Native JSON Schema (`responseMimeType: "application/json"`) |
