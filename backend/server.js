const express = require('express')
const cors = require('cors')
const Database = require('better-sqlite3')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { loadLocalEnv } = require('./local-env')
const { createBaiduOcrService } = require('./baidu-ocr')
const { createOcrStorage } = require('./ocr-storage')

loadLocalEnv(path.join(__dirname, '.env'))

const app = express()
const port = Number(process.env.PORT) || 8889
const host = process.env.HOST || '0.0.0.0'
const databasePath = path.join(__dirname, 'db', 'database.sqlite')
const ocrKeyFilePath = path.join(__dirname, '.local', 'ocr-config.key')
const frontendDistPath = path.join(__dirname, '..', 'frontend', 'dist')
const frontendIndexPath = path.join(frontendDistPath, 'index.html')

fs.mkdirSync(path.dirname(databasePath), { recursive: true })

const db = new Database(databasePath)
db.pragma('journal_mode = WAL')
db.pragma('busy_timeout = 5000')
db.exec(`
  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_date TEXT NOT NULL,
    amount REAL NOT NULL,
    status INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )
`)

const ocrStorage = createOcrStorage({
  db,
  keyFilePath: ocrKeyFilePath,
  environmentKey: process.env.OCR_CONFIG_ENCRYPTION_KEY
})
const environmentOcrCredentials =
  process.env.BAIDU_OCR_API_KEY && process.env.BAIDU_OCR_SECRET_KEY
    ? { apiKey: process.env.BAIDU_OCR_API_KEY, secretKey: process.env.BAIDU_OCR_SECRET_KEY }
    : null
let currentOcrCredentials = null
let ocrCredentialSource = 'none'
let ocrCredentialStorageError = false

try {
  currentOcrCredentials = ocrStorage.loadCredentials()
  if (currentOcrCredentials) ocrCredentialSource = 'database'
} catch (error) {
  ocrCredentialStorageError = true
  console.error(`OCR 凭据存储错误 [${error.code || 'UNKNOWN'}]，请在页面重新配置`)
}

if (!currentOcrCredentials && environmentOcrCredentials) {
  currentOcrCredentials = environmentOcrCredentials
  ocrCredentialSource = 'environment'
}

const createCurrentOcrService = (credentials = currentOcrCredentials) =>
  createBaiduOcrService({
    apiKey: credentials?.apiKey,
    secretKey: credentials?.secretKey,
    endpoint: process.env.BAIDU_OCR_ENDPOINT
  })

let baiduOcr = createCurrentOcrService()

app.use(
  cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173']
  })
)
app.use(express.json({ limit: '100kb' }))

function toLocalISODate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getSaleById(id) {
  return db.prepare('SELECT * FROM sales WHERE id = ?').get(id)
}

const ocrRequestHistory = new Map()
const OCR_DEADLINE_MS = 35000
let activeOcrRequests = 0

function createOcrRequestError(status, message, code) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function getOcrConfigStatus() {
  return ocrStorage.getConfigStatus(currentOcrCredentials, ocrCredentialSource, ocrCredentialStorageError)
}

app.get('/api/ocr/config', (req, res) => {
  return res.json(getOcrConfigStatus())
})

app.put('/api/ocr/config', async (req, res, next) => {
  const apiKeyInput = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : ''
  const secretKeyInput = typeof req.body?.secretKey === 'string' ? req.body.secretKey.trim() : ''
  const expectedVersion = Number(req.body?.version)

  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return res.status(400).json({ message: 'OCR 配置版本无效，请刷新后重试' })
  }
  if (expectedVersion !== getOcrConfigStatus().version) {
    return res.status(409).json({ message: 'OCR 配置已被其他操作更新，请刷新后重试' })
  }
  if (!apiKeyInput && !secretKeyInput) {
    return res.status(400).json({ message: '请至少填写 API Key 或 Secret Key' })
  }

  const apiKey = apiKeyInput || currentOcrCredentials?.apiKey
  const secretKey = secretKeyInput || currentOcrCredentials?.secretKey
  if (!apiKey || !secretKey) {
    return res.status(400).json({ message: '首次配置必须同时填写 API Key 和 Secret Key' })
  }
  if (apiKey.length > 512 || secretKey.length > 512) {
    return res.status(400).json({ message: 'API Key 或 Secret Key 长度无效' })
  }

  const nextCredentials = { apiKey, secretKey }
  const nextService = createCurrentOcrService(nextCredentials)
  const controller = new AbortController()
  const validationTimeout = setTimeout(() => {
    controller.abort(createOcrRequestError(504, '百度 OCR 凭据验证超时', 'OCR_CONFIG_VALIDATION_TIMEOUT'))
  }, 20000)

  try {
    await nextService.validateCredentials({ signal: controller.signal })
    const saved = ocrStorage.saveCredentials({ apiKey, secretKey, expectedVersion })
    currentOcrCredentials = { apiKey: saved.apiKey, secretKey: saved.secretKey }
    ocrCredentialSource = 'database'
    ocrCredentialStorageError = false
    baiduOcr = nextService
    return res.json(getOcrConfigStatus())
  } catch (error) {
    return next(error)
  } finally {
    clearTimeout(validationTimeout)
  }
})

function persistOcrHistory(entry) {
  return ocrStorage.insertHistory(entry)
}

function createHistoryPersistenceError() {
  console.error('OCR 历史记录写入失败 [DATABASE_ERROR]')
  return createOcrRequestError(500, 'OCR 结果持久化失败，请稍后重试', 'OCR_HISTORY_PERSIST_FAILED')
}

function ocrRateLimit(req, res, next) {
  const now = Date.now()
  const windowStart = now - 60 * 1000
  const requestKey = req.ip || req.socket.remoteAddress || 'unknown'
  const recentRequests = (ocrRequestHistory.get(requestKey) || []).filter((timestamp) => timestamp > windowStart)

  if (recentRequests.length >= 10) {
    return res.status(429).json({ message: '文字识别请求过于频繁，请稍后重试' })
  }
  if (activeOcrRequests >= 2) {
    return res.status(429).json({ message: '文字识别服务繁忙，请稍后重试' })
  }

  recentRequests.push(now)
  ocrRequestHistory.set(requestKey, recentRequests)
  activeOcrRequests += 1

  const controller = new AbortController()
  let processing = false
  let released = false
  const abort = (error) => {
    if (!controller.signal.aborted) controller.abort(error)
  }
  const handleRequestAborted = () => {
    abort(createOcrRequestError(499, '客户端已取消文字识别请求', 'OCR_CLIENT_ABORTED'))
  }
  const handleResponseClose = () => {
    if (!res.writableEnded) handleRequestAborted()
    if (!processing) release()
  }
  const handleResponseFinish = () => {
    if (!processing) release()
  }
  const timeout = setTimeout(() => {
    abort(createOcrRequestError(504, '文字识别请求超过 35 秒', 'OCR_DEADLINE_EXCEEDED'))
  }, OCR_DEADLINE_MS)
  const release = () => {
    if (released) return
    released = true
    clearTimeout(timeout)
    req.removeListener('aborted', handleRequestAborted)
    res.removeListener('close', handleResponseClose)
    res.removeListener('finish', handleResponseFinish)
    activeOcrRequests = Math.max(0, activeOcrRequests - 1)
  }

  req.once('aborted', handleRequestAborted)
  res.once('close', handleResponseClose)
  res.once('finish', handleResponseFinish)
  res.locals.ocrRequest = {
    signal: controller.signal,
    startProcessing() {
      processing = true
    },
    release
  }
  return next()
}

function isSupportedOcrImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false
  const isPng = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9
  return isPng || isJpeg
}

function parseOcrImage(req, res, next) {
  if (!req.is(['image/png', 'image/jpeg'])) {
    req.body = undefined
    return next()
  }

  const ocrRequest = res.locals.ocrRequest
  const chunks = []
  const maxBytes = 6 * 1024 * 1024
  let size = 0
  let completed = false

  const cleanup = () => {
    req.removeListener('data', handleData)
    req.removeListener('end', handleEnd)
    req.removeListener('error', handleError)
    ocrRequest.signal.removeEventListener('abort', handleAbort)
  }
  const complete = (callback) => {
    if (completed) return
    completed = true
    cleanup()
    callback()
  }
  const stopReading = () => {
    cleanup()
    req.resume()
  }
  const handleData = (chunk) => {
    size += chunk.length
    if (size > maxBytes) {
      complete(() => {
        stopReading()
        next(createOcrRequestError(413, '提交的图片过大，请压缩后重试', 'OCR_IMAGE_TOO_LARGE'))
      })
      return
    }
    chunks.push(chunk)
  }
  const handleEnd = () => {
    complete(() => {
      req.body = Buffer.concat(chunks)
      next()
    })
  }
  const handleError = (error) => {
    complete(() => next(error))
  }
  const handleAbort = () => {
    complete(() => {
      stopReading()
      const error = ocrRequest.signal.reason || createOcrRequestError(499, '文字识别请求已取消', 'OCR_REQUEST_ABORTED')
      ocrRequest.release()
      if (error.status === 504 && !res.headersSent && !res.writableEnded) {
        res.status(504).json({ message: error.message })
      }
    })
  }

  if (ocrRequest.signal.aborted) {
    handleAbort()
    return
  }
  req.on('data', handleData)
  req.once('end', handleEnd)
  req.once('error', handleError)
  ocrRequest.signal.addEventListener('abort', handleAbort, { once: true })
}

app.post(
  '/api/ocr/amount',
  ocrRateLimit,
  parseOcrImage,
  async (req, res, next) => {
    if (!isSupportedOcrImage(req.body)) {
      return res.status(400).json({ message: '请提交有效的 PNG 或 JPEG 合成图片' })
    }

    const ocrRequest = res.locals.ocrRequest
    const requestId = crypto.randomUUID()
    const startedAt = Date.now()
    ocrRequest.startProcessing()
    try {
      let result
      try {
        result = await baiduOcr.recognizeAmount(req.body, { signal: ocrRequest.signal })
      } catch (ocrError) {
        let historyId
        try {
          historyId = persistOcrHistory({
            requestId,
            status: Number(ocrError.status) === 499 ? 'cancelled' : 'failure',
            wordsCount: ocrError.ocrDetails?.wordsCount,
            recognizedText: ocrError.ocrDetails?.recognizedText,
            errorCode: ocrError.code,
            httpStatus: Number(ocrError.status) || 500,
            errorMessage: ocrError.message,
            durationMs: Date.now() - startedAt
          })
        } catch (historyError) {
          return next(createHistoryPersistenceError())
        }
        ocrError.historyId = historyId
        return next(ocrError)
      }

      let historyId
      try {
        historyId = persistOcrHistory({
          requestId,
          status: 'success',
          amount: result.amount,
          matchedText: result.matchedText,
          wordsCount: result.wordsCount,
          recognizedText: result.recognizedText,
          httpStatus: 200,
          durationMs: Date.now() - startedAt
        })
      } catch (historyError) {
        return next(createHistoryPersistenceError())
      }
      return res.json({ ...result, historyId })
    } finally {
      ocrRequest.release()
    }
  }
)

app.get('/api/ocr/history', (req, res) => {
  const page = req.query.page === undefined ? 1 : Number(req.query.page)
  const pageSize = req.query.pageSize === undefined ? 10 : Number(req.query.pageSize)
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    return res.status(400).json({ message: 'page 必须大于 0，pageSize 必须在 1 到 50 之间' })
  }
  return res.json(ocrStorage.listHistory({ page, pageSize }))
})

app.get('/api/ocr/history/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: '无效的 OCR 记录 ID' })
  }
  const history = ocrStorage.getHistoryById(id)
  if (!history) return res.status(404).json({ message: 'OCR 识别记录不存在' })
  return res.json(history)
})

app.post('/api/sales', (req, res) => {
  const amount = Number(req.body?.amount)

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ message: '销售金额必须是大于 0 的数字' })
  }

  const roundedAmount = Math.round(amount * 100) / 100
  const result = db
    .prepare('INSERT INTO sales (sale_date, amount, status) VALUES (?, ?, 1)')
    .run(toLocalISODate(), roundedAmount)

  return res.status(201).json(getSaleById(result.lastInsertRowid))
})

app.get('/api/sales', (req, res) => {
  const { status } = req.query
  let rows

  if (status === undefined || status === '') {
    rows = db.prepare('SELECT * FROM sales ORDER BY created_at DESC, id DESC').all()
  } else if (status === '0' || status === '1') {
    rows = db
      .prepare('SELECT * FROM sales WHERE status = ? ORDER BY created_at DESC, id DESC')
      .all(Number(status))
  } else {
    return res.status(400).json({ message: 'status 只能是 0 或 1' })
  }

  return res.json(rows)
})

app.get('/api/sales/today', (req, res) => {
  const row = db
    .prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
      FROM sales
      WHERE sale_date = ? AND status = 1
    `)
    .get(toLocalISODate())

  return res.json({ count: row.count, total: row.total })
})

app.get('/api/sales/trend', (req, res) => {
  const startDate = new Date()
  startDate.setHours(0, 0, 0, 0)
  startDate.setDate(startDate.getDate() - 29)

  const rows = db
    .prepare(`
      SELECT sale_date AS date, ROUND(SUM(amount), 2) AS total
      FROM sales
      WHERE status = 1 AND sale_date >= ?
      GROUP BY sale_date
      ORDER BY sale_date ASC
    `)
    .all(toLocalISODate(startDate))

  const totalsByDate = new Map(rows.map((row) => [row.date, row.total]))
  const trend = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(startDate)
    date.setDate(startDate.getDate() + index)
    const dateString = toLocalISODate(date)
    return { date: dateString, total: totalsByDate.get(dateString) || 0 }
  })

  return res.json(trend)
})

app.put('/api/sales/:id/toggle', (req, res) => {
  const id = Number(req.params.id)

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: '无效的销售记录 ID' })
  }

  const sale = getSaleById(id)
  if (!sale) {
    return res.status(404).json({ message: '销售记录不存在' })
  }

  db.prepare('UPDATE sales SET status = ? WHERE id = ?').run(sale.status === 1 ? 0 : 1, id)
  return res.json(getSaleById(id))
})

if (fs.existsSync(frontendIndexPath)) {
  app.use(express.static(frontendDistPath))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    return res.sendFile(frontendIndexPath)
  })
}

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error)

  if (error.type === 'entity.too.large') {
    return res.status(413).json({ message: '提交的图片过大，请压缩后重试' })
  }

  const status = Number(error.status)
  if (Number.isInteger(status) && status >= 400 && status < 600) {
    if (status >= 500) console.error(`OCR/API 错误 [${error.code || status}]：${error.message}`)
    const response = { message: error.message }
    if (error.code) response.code = error.code
    if (error.historyId) response.historyId = error.historyId
    return res.status(status).json(response)
  }

  console.error(error)
  return res.status(500).json({ message: '服务器内部错误' })
})

const server = app.listen(port, host, () => {
  console.log(`门店小票打印助手已启动：http://localhost:${port}`)
  console.log(`局域网访问：http://<本机局域网IP>:${port}`)
})

function shutdown() {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
