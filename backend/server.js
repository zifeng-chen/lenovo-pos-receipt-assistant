const express = require('express')
const cors = require('cors')
const Database = require('better-sqlite3')
const fs = require('fs')
const path = require('path')

const app = express()
const port = Number(process.env.PORT) || 3000
const databasePath = path.join(__dirname, 'db', 'database.sqlite')

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

app.use((error, req, res, next) => {
  console.error(error)
  if (res.headersSent) return next(error)
  return res.status(500).json({ message: '服务器内部错误' })
})

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`门店小票打印助手后端已启动：http://localhost:${port}`)
})

function shutdown() {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
