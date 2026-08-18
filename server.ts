import express from "express";
import cors from "cors";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

class ConcurrencyLimiter {
  private activeCount = 0;
  private queue: (() => void)[] = [];
  private lastRunTime = 0;

  constructor(private maxConcurrency: number, private minDelayMs = 0) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.maxConcurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.activeCount++;
    try {
      const now = Date.now();
      const elapsed = now - this.lastRunTime;
      if (elapsed < this.minDelayMs && this.lastRunTime > 0) {
        await new Promise((r) => setTimeout(r, this.minDelayMs - elapsed));
      }
      const res = await fn();
      this.lastRunTime = Date.now();
      return res;
    } finally {
      this.activeCount--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next?.();
      }
    }
  }
}

const geminiLimiter = new ConcurrencyLimiter(1, 2000);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json({ limit: "50mb" }));

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // API endpoint for report extraction
  app.post("/api/extract-report", async (req, res) => {
    try {
      const { base64Image } = req.body;
      if (!base64Image) {
        return res.status(400).json({ error: "No image data provided" });
      }

      const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server" });
      }

      const ai = new GoogleGenAI({ apiKey });
      const cleanBase64 = base64Image.split(",")[1] || base64Image;

      const prompt = `
        You are an expert financial auditor analyzing daily store settlement reports.
        
        **IMAGE STRUCTURE ANALYSIS:**
        The image typically contains a structured form or handwritten note with:
        1. **Summary Section (Left/Main Column):** Contains key headers like "Expense", "Cash", "Card", "UPI".
        2. **Detailed Section (Right/Secondary Column):** Contains breakdowns (e.g., "Tea", "Porter", "Travel").
        3. **Totals:** A "Total Sale" or "Total" line at the bottom.

        **YOUR TASK:** Extract the **Physical/Actual** counts for each payment mode.

        **CRITICAL EXTRACTION RULES:**
        
        1. **The "Expense" Rule:**
           - Look for a main "Expense" line in the Summary Section (e.g., "Expense: 900").
           - **USE THIS VALUE.** 
           - **IGNORE** the Detailed Section (e.g., Tea 40, Porter 860) if the main Expense total is present. They are just a breakdown of the 900.
           - **DO NOT** add the details to the total. (900 + 40 + 860 = WRONG. Just 900 = CORRECT).
        
        2. **The "Cash" Rule:**
           - Look for "Cash", "Cash in Hand", "By Cash".
           - Be careful not to confuse "Cash" (1420) with other numbers.
           - If you see "Cash Collected", verify if it refers to the same "Cash" value.
        
        3. **The "Total Sale" Calculation (CRITICAL CHANGE):**
           - **DO NOT** blindly trust the "Total" written on the paper. Store managers often make calculation errors.
           - **EXTRACT** the individual values first: Cash, Expenses, Card, UPI, Sodexo.
           - **CALCULATE INTERNALLY:** (Cash + Expenses + Card + UPI + Sodexo).
           - **COMPARE:** Does your sum match the written total?
           - **DECISION:** If there is a mismatch, **TRUST YOUR EXTRACTED COMPONENTS** (the individual numbers you see) and ignore the written total. The individual numbers are the source of truth.
           - Only adjust your extracted numbers if you clearly see you misread a digit (e.g. reading 500 as 800). Do not invent numbers to match the total.

        4. **Handling Blanks:**
           - If "Staff Advance" or "Vendor Payment" has no number next to it (empty box), treat it as 0.

        5. **Bank Slips/Obstructions:**
           - If a printed slip covers the handwriting, use the numbers from the printed slip for that category (usually Card totals).

        **OUTPUT SCHEMA FIELDS:**
        - **cashCount**: The specific cash amount (e.g., 1420).
        - **expenses**: The total expenses (e.g., 900).
        - **cardMachineTotal**: Card total.
        - **upiMachineTotal**: UPI/Online total.
        - **sodexoTotal**: Sodexo total.
        - **totalSales**: The SUM of the above components (Cash + Expenses + Card + UPI + Sodexo). Calculate this yourself.
        - **extractedStoreName**: Name of the store.
        - **extractedDate**: Date in YYYY-MM-DD.

        **Return numbers exactly as written.**
      `;

      let lastError: any = null;
      const modelsToTry = ["gemini-3.5-flash", "gemini-2.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"];

      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          if (attempt > 0) {
            console.log(`Gemini retry attempt ${attempt}...`);
            await new Promise((resolve) => setTimeout(resolve, 2500));
          }

          const currentModel = modelsToTry[attempt % modelsToTry.length];

          const response = await geminiLimiter.run(() =>
            ai.models.generateContent({
              model: currentModel,
              contents: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/jpeg",
                      data: cleanBase64,
                    },
                  },
                  { text: prompt },
                ],
              },
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    extractedStoreName: { type: Type.STRING, description: "Store name found in handwriting or receipt" },
                    extractedDate: { type: Type.STRING, description: "YYYY-MM-DD date found" },
                    cashCount: { type: Type.NUMBER, description: "Physical cash in hand (excluding expenses)" },
                    expenses: { type: Type.NUMBER, description: "Total expenses paid out" },
                    upiMachineTotal: { type: Type.NUMBER, description: "Physical UPI/Online total" },
                    cardMachineTotal: { type: Type.NUMBER, description: "Physical Card/POS settlement total" },
                    sodexoTotal: { type: Type.NUMBER, description: "Physical Sodexo/Meal Pass total" },
                    totalSales: { type: Type.NUMBER, description: "Calculated Sum: cashCount + expenses + upi + card + sodexo" },
                  },
                  required: ["cashCount", "expenses", "upiMachineTotal", "cardMachineTotal", "sodexoTotal"],
                },
              },
            })
          );

          if (response.text) {
            const parsedData = JSON.parse(response.text);
            return res.json(parsedData);
          }

          throw new Error("No data returned from Gemini");
        } catch (err: any) {
          lastError = err;
          const status = err?.status || err?.code || 0;
          const errMsg = String(err?.message || "").toLowerCase();
          // Retry on 503 UNAVAILABLE, 429 RESOURCE_EXHAUSTED, quota exceeded, 404 NOT_FOUND, high demand, or transient errors
          if (
            status === "UNAVAILABLE" ||
            status === 503 ||
            status === 429 ||
            status === "RESOURCE_EXHAUSTED" ||
            status === 404 ||
            status === "NOT_FOUND" ||
            errMsg.includes("high demand") ||
            errMsg.includes("unavailable") ||
            errMsg.includes("overloaded") ||
            errMsg.includes("quota") ||
            errMsg.includes("rate limit") ||
            errMsg.includes("exceeded") ||
            errMsg.includes("not found") ||
            errMsg.includes("not supported")
          ) {
            continue;
          }
          throw err;
        }
      }

      let userErrorMessage = "Failed to analyze report after multiple attempts due to high server demand.";
      if (lastError) {
        const errMsg = String(lastError?.message || "").toLowerCase();
        if (errMsg.includes("quota") || errMsg.includes("exceeded") || errMsg.includes("rate limit") || lastError?.status === 429) {
          userErrorMessage = "Gemini API rate limit or quota exceeded for this API key. Please wait ~1 minute or configure a paid API key in Settings.";
        }
      }

      throw new Error(userErrorMessage);
    } catch (error: any) {
      console.error("Server Extraction Error:", error);
      res.status(500).json({ error: error.message || "Failed to analyze report image" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((req, res, next) => {
      if (req.method === "GET" && !req.path.startsWith("/api")) {
        res.sendFile(path.join(distPath, "index.html"));
      } else {
        next();
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
