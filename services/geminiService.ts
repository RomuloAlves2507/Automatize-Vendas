import { GoogleGenAI, Type } from "@google/genai";

// Helper to remove the data URL prefix for Gemini
const cleanBase64 = (base64: string) => base64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

export const analyzeInvoiceImage = async (base64Image: string): Promise<any> => {
  if (!process.env.API_KEY) {
    console.error("API Key missing");
    throw new Error("API Key is missing. Please check your environment configuration.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const systemInstruction = `
    You are an expert data entry assistant for a retail store. 
    Analyze the provided image of an invoice or receipt.
    Extract the total amount, the date, and a list of items purchased.
    For each item, try to identify the product name, the unit cost, and the quantity.
    If the image is not clear, do your best to infer.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: 'image/jpeg',
              data: cleanBase64(base64Image)
            }
          },
          {
            text: "Extract invoice data into JSON."
          }
        ]
      },
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                date: { type: Type.STRING, description: "Date of purchase in YYYY-MM-DD format" },
                total: { type: Type.NUMBER, description: "Total amount of the invoice" },
                items: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            name: { type: Type.STRING },
                            cost: { type: Type.NUMBER },
                            quantity: { type: Type.NUMBER }
                        }
                    }
                }
            }
        }
      }
    });

    return JSON.parse(response.text || "{}");
  } catch (error) {
    console.error("Gemini Invoice Error:", error);
    throw error;
  }
};

export const identifyProductFromImage = async (base64Image: string): Promise<any> => {
    if (!process.env.API_KEY) return null;

    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
                parts: [
                    { inlineData: { mimeType: 'image/jpeg', data: cleanBase64(base64Image) } },
                    { text: "Identify this product. Provide a short name, a category, and an estimated retail price in BRL." }
                ]
            },
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        name: { type: Type.STRING },
                        category: { type: Type.STRING },
                        estimatedPrice: { type: Type.NUMBER }
                    }
                }
            }
        });
        return JSON.parse(response.text || "{}");
    } catch (error) {
        console.error("Gemini Product ID Error:", error);
        return null;
    }
}

export const readBarcodeFromImage = async (base64Image: string): Promise<string | null> => {
    // 1. Try Native BarcodeDetector (Chrome/Edge/Android)
    if ('BarcodeDetector' in window) {
        try {
            const barcodeDetector = new (window as any).BarcodeDetector({ 
                formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'code_128'] 
            });
            
            // Create an Image object from base64
            const img = new Image();
            img.src = base64Image;
            await new Promise((resolve) => { img.onload = resolve; });
            
            const barcodes = await barcodeDetector.detect(img);
            if (barcodes.length > 0) {
                return barcodes[0].rawValue;
            }
        } catch (e) {
            console.warn("Native BarcodeDetector failed, falling back to Gemini.", e);
        }
    }

    // 2. Fallback to Gemini
    if (!process.env.API_KEY) return null;
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: {
                parts: [
                    { inlineData: { mimeType: 'image/jpeg', data: cleanBase64(base64Image) } },
                    { text: "Read the barcode or UPC number from this image. Return ONLY the number digits as a plain string. If no barcode is found, return null." }
                ]
            },
            config: {
                responseMimeType: "text/plain",
            }
        });
        const text = response.text?.trim();
        return (text && text.toLowerCase() !== 'null') ? text.replace(/\D/g, '') : null;
    } catch (error) {
        console.error("Gemini Barcode Read Error:", error);
        return null;
    }
};