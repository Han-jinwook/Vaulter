export type VisionParseResult = {
  merchant: string
  date: string | null
  amount: number
  category: string
  reasoning: string
  confidence: number
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const raw = String(reader.result || '')
      const base64 = raw.includes(',') ? raw.split(',')[1] : raw
      if (!base64) {
        reject(new Error('파일 인코딩 실패'))
        return
      }
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'))
    reader.readAsDataURL(file)
  })
}

function normalizeDate(dateValue: unknown): string | null {
  const text = String(dateValue || '').trim()
  if (!text) return null
  const m = text.match(/(\d{4})[-./년]\s*(\d{1,2})[-./월]\s*(\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
}

export async function analyzeDocumentWithGPT(imageFile: File): Promise<VisionParseResult> {
  const imageBase64 = await fileToBase64(imageFile)
  const mimeType = imageFile.type || 'image/jpeg'

  const response = await fetch('/api/analyze-receipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mimeType }),
  })

  if (!response.ok) {
    let detail = ''
    try {
      const errJson = await response.json()
      detail = errJson?.error || errJson?.detail || ''
    } catch {
      detail = await response.text()
    }
    throw new Error(`비전 분석 실패 (${response.status})${detail ? `: ${detail}` : ''}`)
  }

  const payload = await response.json()
  const data = payload?.data || payload

  return {
    merchant: String(data?.merchant || '가맹점 미확인').trim(),
    date: normalizeDate(data?.date),
    amount: Number(data?.amount || 0),
    category: String(data?.category || '기타').trim(),
    reasoning: String(data?.reasoning || '').trim(),
    confidence: Number(data?.confidence || 0.8),
  }
}

