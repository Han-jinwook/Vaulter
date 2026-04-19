export type UploadFileKind = 'image' | 'csv' | 'xlsx' | 'pdf' | 'unsupported'

export type LocalDocumentExtraction = {
  documentType: 'csv' | 'xlsx' | 'pdf'
  sourceName: string
  textBlocks: string[]
  columnHints: string[]
  approxItemCount: number
}

function normalizeCell(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getFileExtension(fileName: string) {
  const parts = String(fileName || '').toLowerCase().split('.')
  return parts.length > 1 ? parts.pop() || '' : ''
}

function toSourceName(fileName: string) {
  return String(fileName || '문서')
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim() || '문서'
}

function isMostlyNumeric(text: string) {
  return /^[\d\s,./:-]+$/.test(text)
}

function looksLikeHeaderRow(row: string[]) {
  const meaningful = row.map(normalizeCell).filter(Boolean)
  if (meaningful.length < 2) return false
  const numericCount = meaningful.filter(isMostlyNumeric).length
  return numericCount <= Math.floor(meaningful.length / 2)
}

function rowsToTextBlocks(rows: string[][], prefix?: string) {
  if (!rows.length) {
    return {
      textBlocks: [] as string[],
      columnHints: [] as string[],
      approxItemCount: 0,
    }
  }

  const normalizedRows = rows
    .map((row) => row.map(normalizeCell))
    .filter((row) => row.some(Boolean))

  if (!normalizedRows.length) {
    return {
      textBlocks: [] as string[],
      columnHints: [] as string[],
      approxItemCount: 0,
    }
  }

  const headerRow = looksLikeHeaderRow(normalizedRows[0]) ? normalizedRows[0] : []
  const dataRows = headerRow.length ? normalizedRows.slice(1) : normalizedRows
  const labelPrefix = prefix ? `[${prefix}] ` : ''

  const textBlocks = dataRows.map((row, index) => {
    if (headerRow.length && row.length) {
      const pairs = row
        .map((cell, cellIndex) => {
          const header = normalizeCell(headerRow[cellIndex] || `col${cellIndex + 1}`)
          return `${header}: ${normalizeCell(cell)}`
        })
        .filter((entry) => !entry.endsWith(':'))
      return `${labelPrefix}row ${index + 1}: ${pairs.join(' | ')}`
    }
    return `${labelPrefix}row ${index + 1}: ${row.filter(Boolean).join(' | ')}`
  })

  return {
    textBlocks,
    columnHints: headerRow,
    approxItemCount: dataRows.length,
  }
}

async function parseCsvFile(file: File): Promise<LocalDocumentExtraction> {
  const Papa = (await import('papaparse')).default
  const text = await file.text()
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
  })

  if (parsed.errors.length) {
    throw new Error(`CSV 파싱 실패: ${parsed.errors[0]?.message || '형식을 읽지 못했습니다.'}`)
  }

  const rows = Array.isArray(parsed.data) ? parsed.data : []
  const table = rowsToTextBlocks(rows)
  return {
    documentType: 'csv',
    sourceName: toSourceName(file.name),
    ...table,
  }
}

async function parseXlsxFile(file: File): Promise<LocalDocumentExtraction> {
  const XLSX = await import('xlsx')
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetNames = workbook.SheetNames || []
  const allBlocks: string[] = []
  const allHints: string[] = []
  let approxItemCount = 0

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    }) as string[][]
    const table = rowsToTextBlocks(rows, `sheet ${sheetName}`)
    allBlocks.push(...table.textBlocks)
    allHints.push(...table.columnHints)
    approxItemCount += table.approxItemCount
  }

  if (!allBlocks.length) {
    throw new Error('엑셀에서 읽을 수 있는 데이터 행을 찾지 못했습니다.')
  }

  return {
    documentType: 'xlsx',
    sourceName: toSourceName(file.name),
    textBlocks: allBlocks,
    columnHints: Array.from(new Set(allHints.filter(Boolean))).slice(0, 20),
    approxItemCount,
  }
}

async function parsePdfFile(file: File): Promise<LocalDocumentExtraction> {
  const pdfjs = await import('pdfjs-dist')
  const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default

  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data }).promise
  const textBlocks: string[] = []

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? normalizeCell(item.str) : ''))
      .filter(Boolean)
      .join(' ')
      .trim()

    if (pageText) {
      textBlocks.push(`[page ${pageNum}] ${pageText}`)
    }
  }

  const totalLength = textBlocks.join('\n').trim().length
  if (totalLength < 40) {
    throw new Error('텍스트 레이어가 거의 없는 PDF입니다. 스캔형 PDF는 아직 지원되지 않습니다.')
  }

  return {
    documentType: 'pdf',
    sourceName: toSourceName(file.name),
    textBlocks,
    columnHints: [],
    approxItemCount: textBlocks.length,
  }
}

export function detectUploadFileKind(file: File): UploadFileKind {
  const type = String(file?.type || '').toLowerCase()
  const ext = getFileExtension(file?.name || '')

  if (type.startsWith('image/')) return 'image'
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf'
  if (type.includes('csv') || ext === 'csv') return 'csv'
  if (
    type.includes('sheet') ||
    type.includes('excel') ||
    ext === 'xlsx' ||
    ext === 'xls'
  ) {
    return 'xlsx'
  }

  return 'unsupported'
}

export async function extractLocalDocument(file: File): Promise<LocalDocumentExtraction> {
  const kind = detectUploadFileKind(file)

  if (kind === 'csv') return parseCsvFile(file)
  if (kind === 'xlsx') return parseXlsxFile(file)
  if (kind === 'pdf') return parsePdfFile(file)

  throw new Error('지원되지 않는 문서 형식입니다.')
}

/** Drive에서 내보낸 CSV 텍스트를 LocalDocumentExtraction으로 변환 */
export async function parseCsvText(csvText: string, sourceName: string): Promise<LocalDocumentExtraction> {
  const Papa = (await import('papaparse')).default
  const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: 'greedy' })
  if (parsed.errors.length && !parsed.data.length) {
    throw new Error(`CSV 파싱 실패: ${parsed.errors[0]?.message || '형식을 읽지 못했습니다.'}`)
  }
  const rows = Array.isArray(parsed.data) ? parsed.data : []
  const table = rowsToTextBlocks(rows)
  return {
    documentType: 'csv',
    sourceName: String(sourceName || '스프레드시트').trim() || '스프레드시트',
    ...table,
  }
}
