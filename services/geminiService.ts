
import { GoogleGenAI, Type } from "@google/genai";
import { PhysicalData } from "../types";

const getClient = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

export const extractHandwrittenReport = async (base64Image: string): Promise<PhysicalData> => {
  const ai = getClient();
  
  // Clean base64 string if it contains metadata header
  const cleanBase64 = base64Image.split(',')[1] || base64Image;

  const prompt = `
    You are an expert financial auditor analyzing daily store settlement reports.
    
    **IMAGE STRUCTURE ANALYSIS:**
    The image typically contains a structured form or handwritten note with:
    1. **Summary Section (Left/Main Column):** Contains key headers like "Expense", "Cash", "Card", "UPI".
    2. **Detailed Section (Right/Secondary Column):** Contains breakdowns (e.g., "Tea", "Porter", "Travel").
    3. **Totals:** A "Total Sale" or "Total" line at the bottom.

    **YOUR TASK:** Extract the **Physical/Actual** counts.

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
    
    3. **The "Total Sale" Validation (THE MOST IMPORTANT STEP):**
       - Find the "Total Sale" or "Total" written on the paper (e.g., 24806).
       - **CALCULATE INTERNALLY:** (Your Extracted Cash + Your Extracted Expense + Your Extracted Card + Your Extracted UPI + Your Extracted Sodexo).
       - **COMPARE:** Does Your Sum match the Written Total?
       - **IF MISMATCH:** You have likely misread a digit (e.g., 1420 vs 920, 500 vs 800) or missed a line item (like "Staff Advance").
       - **CORRECTION:** Adjust your extracted numbers until they sum up to the Written Total. Trust the Written Total as the source of truth for the sum.

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
    - **totalSales**: The "Total Sale" written on the paper.
    - **extractedStoreName**: Name of the store.
    - **extractedDate**: Date in YYYY-MM-DD.

    **Return numbers exactly as written.**
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: cleanBase64
            }
          },
          { text: prompt }
        ]
      },
      config: {
        // High thinking budget for verification arithmetic
        thinkingConfig: { thinkingBudget: 16384 }, 
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
            totalSales: { type: Type.NUMBER, description: "The Grand Total / Total Sale written on the document" },
          },
          required: ["cashCount", "expenses", "upiMachineTotal", "cardMachineTotal", "sodexoTotal"]
        }
      }
    });

    if (response.text) {
      return JSON.parse(response.text) as PhysicalData;
    }
    throw new Error("No data returned from Gemini");
  } catch (error) {
    console.error("Gemini Extraction Error:", error);
    throw error;
  }
};
