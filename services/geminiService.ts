
import { PhysicalData } from "../types";

export const extractHandwrittenReport = async (base64Image: string): Promise<PhysicalData> => {
  try {
    const response = await fetch("/api/extract-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ base64Image }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Server error (${response.status})`);
    }

    const data = await response.json();
    return data as PhysicalData;
  } catch (error) {
    console.error("Report extraction error:", error);
    throw error;
  }
};
