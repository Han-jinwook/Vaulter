export type VisionParseResult = {
  merchant: string
  date: string | null
  amount: number
  category: string
  reasoning: string
  confidence: number
}

export type DocumentAnalysisChunk = {
  documentType: 'csv' | 'xlsx' | 'pdf'
  sourceName: string
  chunkIndex: number
  totalChunks: number
  chunkText: string
  columnHints: string[]
  itemStart: number
  itemEnd: number
}

export type DocumentParseResult = VisionParseResult & {
  account?: string
  sourceRef?: string
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

function normalizeAmount(amountValue: unknown) {
  if (typeof amountValue === 'number' && Number.isFinite(amountValue)) {
    return Math.abs(amountValue)
  }
  const text = String(amountValue || '')
    .replace(/[^\d.-]/g, '')
    .trim()
  const parsed = Number(text)
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0
}

function normalizeDocumentItem(data: any, chunk: DocumentAnalysisChunk, index: number): DocumentParseResult {
  return {
    merchant: String(data?.merchant || chunk.sourceName || '문서 항목').trim() || '문서 항목',
    date: normalizeDate(data?.date),
    amount: normalizeAmount(data?.amount),
    category: String(data?.category || '기타').trim() || '기타',
    account: String(data?.account || '').trim(),
    reasoning: String(data?.reasoning || '').trim(),
    confidence: Number(data?.confidence || 0.75),
    sourceRef: `${chunk.sourceName}:${chunk.chunkIndex}:${chunk.itemStart + index}`,
  }
}

export async function analyzeDocumentWithGPT(imageFile: File): Promise<VisionParseResult> {
  const imageBase64 = await fileToBase64(imageFile)
  const mimeType = imageFile.type || 'image/jpeg'

  const response = await fetch('/api/analyze-receipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mimeType, fileName: imageFile.name || '' }),
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

export async function analyzeDocumentChunks(
  chunks: DocumentAnalysisChunk[],
  onProgress?: (completed: number, total: number) => void,
): Promise<DocumentParseResult[]> {
  const results: DocumentParseResult[] = []

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const response = await fetch('/api/analyze-document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk),
    })

    if (!response.ok) {
      let detail = ''
      try {
        const errJson = await response.json()
        detail = errJson?.error || errJson?.detail || ''
      } catch {
        detail = await response.text()
      }
      throw new Error(`문서 분석 실패 (${response.status})${detail ? `: ${detail}` : ''}`)
    }

    const payload = await response.json()
    const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload?.data?.items) ? payload.data.items : []
    results.push(
      ...items
        .map((item: any, index: number) => normalizeDocumentItem(item, chunk, index))
        .filter((item: DocumentParseResult) => item.amount > 0)
    )
    if (onProgress) onProgress(i + 1, chunks.length)
  }

  return results
}

