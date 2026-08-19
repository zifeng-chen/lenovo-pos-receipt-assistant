const https = require('https')

const DEFAULT_OCR_ENDPOINT = 'https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic'
const TOKEN_ENDPOINT = 'https://aip.baidubce.com/oauth/2.0/token'
const MAX_ENCODED_IMAGE_BYTES = 8 * 1024 * 1024

function createHttpError(status, message, code) {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function getAbortError(signal) {
  if (signal?.reason instanceof Error && signal.reason.status) return signal.reason
  return createHttpError(499, '文字识别请求已取消', 'OCR_REQUEST_ABORTED')
}

function requestJson(url, { method = 'GET', headers = {}, body = '', timeout = 20000, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(getAbortError(signal))
      return
    }

    let settled = false
    const request = https.request(url, { method, headers }, (response) => {
      const chunks = []
      let responseSize = 0

      response.on('data', (chunk) => {
        responseSize += chunk.length
        if (responseSize > 2 * 1024 * 1024) {
          request.destroy(createHttpError(502, '百度 OCR 响应过大', 'BAIDU_RESPONSE_TOO_LARGE'))
          return
        }
        chunks.push(chunk)
      })

      response.on('aborted', () => {
        settle(reject, createHttpError(502, '百度 OCR 响应意外中断', 'BAIDU_RESPONSE_ABORTED'))
      })

      response.on('end', () => {
        const rawBody = Buffer.concat(chunks).toString('utf8')
        let data
        try {
          data = rawBody ? JSON.parse(rawBody) : {}
        } catch (error) {
          settle(reject, createHttpError(502, '百度 OCR 返回了无效响应', 'BAIDU_INVALID_RESPONSE'))
          return
        }

        if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
          settle(
            reject,
            createHttpError(502, `百度 OCR 请求失败（HTTP ${response.statusCode || 'unknown'}）`, 'BAIDU_HTTP_ERROR')
          )
          return
        }
        settle(resolve, data)
      })
    })

    const cleanup = () => signal?.removeEventListener('abort', handleAbort)
    const settle = (handler, value) => {
      if (settled) return
      settled = true
      cleanup()
      handler(value)
    }
    const handleAbort = () => request.destroy(getAbortError(signal))

    signal?.addEventListener('abort', handleAbort, { once: true })
    request.setTimeout(timeout, () => {
      request.destroy(createHttpError(504, '百度 OCR 请求超时', 'BAIDU_TIMEOUT'))
    })
    request.on('error', (error) => {
      if (error.status) settle(reject, error)
      else settle(reject, createHttpError(502, '无法连接百度 OCR 服务', 'BAIDU_NETWORK_ERROR'))
    })

    if (body) request.write(body)
    request.end()
  })
}

function normalizeText(text) {
  return String(text || '')
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10))
    .replace(/[，]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/[：]/g, ':')
    .replace(/[￥]/g, '¥')
    .replace(/\s+/g, ' ')
    .trim()
}

function findAmounts(text, allowInteger = false) {
  const normalized = normalizeText(text)
  const amountPattern = /(?:[¥￥]\s*)?(-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})|-?\d+(?:\.\d{1,2})?)/gi
  const candidates = []
  let match

  while ((match = amountPattern.exec(normalized))) {
    const raw = match[0]
    const numericText = match[1].replace(/,/g, '')
    const value = Number(numericText)
    const hasCurrency = /[¥￥]/.test(raw)
    const hasDecimal = numericText.includes('.')
    if (!Number.isFinite(value) || value <= 0 || value > 10000000) continue
    if (!allowInteger && !hasCurrency && !hasDecimal) continue
    if (!hasCurrency && !hasDecimal && value >= 1900 && value <= 2200) continue

    candidates.push({
      value: Math.round(value * 100) / 100,
      raw,
      hasCurrency,
      hasDecimal,
      index: match.index,
      end: match.index + raw.length
    })
  }

  return candidates
}

function findImmediateUniqueAmount(text) {
  const normalized = normalizeText(text)
  const prefix = normalized.match(/^[\s:：=\-—]*(?:(?:人民币|RMB|CNY)\s*)?(?:[（(]?\s*元\s*[）)]?)?[\s:：=\-—]*/i)
  const valueText = normalized.slice(prefix?.[0].length || 0)
  const amounts = findAmounts(valueText, true)

  if (amounts.length !== 1 || amounts[0].index !== 0) return null
  return amounts[0]
}

function extractReceiptAmount(words) {
  const lines = words.map(normalizeText).filter(Boolean)
  const labels = [
    { pattern: /(实收金额|实付金额|支付金额|应付金额|应收金额|价税合计|本次收款)/i, score: 120 },
    { pattern: /(实收|实付|支付|应付|应收|总计|合计|total|amount)/i, score: 100 }
  ]
  const candidates = []

  lines.forEach((line, index) => {
    const label = labels
      .map((item) => ({ ...item, match: item.pattern.exec(line) }))
      .find((item) => item.match)
    if (!label) return

    const afterLabel = line.slice(label.match.index + label.match[0].length)
    const sameLineAmount = findImmediateUniqueAmount(afterLabel)
    if (sameLineAmount) {
      candidates.push({
        ...sameLineAmount,
        score: label.score + 20,
        matchedText: line
      })
      return
    }

    if (findAmounts(afterLabel, true).length > 0 || !lines[index + 1]) return
    const nextLineAmount = findImmediateUniqueAmount(lines[index + 1])
    if (!nextLineAmount) return

    candidates.push({
      ...nextLineAmount,
      score: label.score,
      matchedText: `${line} ${lines[index + 1]}`
    })
  })

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  if (!best) return null

  const equallyTrustedValues = new Set(
    candidates.filter((candidate) => candidate.score === best.score).map((candidate) => candidate.value.toFixed(2))
  )
  if (equallyTrustedValues.size !== 1) return null
  return best
}

function createBaiduOcrService({ apiKey, secretKey, endpoint = DEFAULT_OCR_ENDPOINT } = {}) {
  let accessToken = null
  let tokenExpiresAt = 0
  let tokenRequest = null

  function ensureConfigured() {
    if (!apiKey || !secretKey) {
      throw createHttpError(503, '百度 OCR 尚未配置，请设置后端 API Key 和 Secret Key', 'OCR_NOT_CONFIGURED')
    }
  }

  async function requestAccessToken(signal) {
    ensureConfigured()
    const url = new URL(TOKEN_ENDPOINT)
    url.searchParams.set('grant_type', 'client_credentials')
    url.searchParams.set('client_id', apiKey)
    url.searchParams.set('client_secret', secretKey)

    const data = await requestJson(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      signal
    })
    if (!data.access_token) {
      throw createHttpError(502, '百度 OCR 凭据验证失败', 'BAIDU_TOKEN_ERROR')
    }

    accessToken = data.access_token
    const expiresIn = Number(data.expires_in) || 2592000
    tokenExpiresAt = Date.now() + Math.max(expiresIn - 300, 60) * 1000
    return accessToken
  }

  function startTokenRequest() {
    const controller = new AbortController()
    const state = {
      controller,
      waiters: new Set(),
      settled: false,
      promise: null
    }

    state.promise = requestAccessToken(controller.signal)
    tokenRequest = state
    const finish = () => {
      state.settled = true
      if (tokenRequest === state) tokenRequest = null
    }
    state.promise.then(finish, finish)
    return state
  }

  function waitForTokenRequest(state, signal) {
    const waiter = Symbol('token-waiter')
    state.waiters.add(waiter)

    return new Promise((resolve, reject) => {
      let finished = false
      const finish = (handler, value, abortShared = false) => {
        if (finished) return
        finished = true
        signal?.removeEventListener('abort', handleAbort)
        state.waiters.delete(waiter)
        if (abortShared && !state.settled && state.waiters.size === 0) {
          state.controller.abort(value)
        }
        handler(value)
      }
      const handleAbort = () => finish(reject, getAbortError(signal), true)

      if (signal?.aborted) {
        handleAbort()
        return
      }
      signal?.addEventListener('abort', handleAbort, { once: true })
      state.promise.then(
        (token) => finish(resolve, token),
        (error) => finish(reject, error)
      )
    })
  }

  function getAccessToken(forceRefresh = false, signal) {
    if (!forceRefresh && accessToken && Date.now() < tokenExpiresAt) return Promise.resolve(accessToken)

    const state = tokenRequest || startTokenRequest()
    return waitForTokenRequest(state, signal)
  }

  async function callOcr(imageBuffer, { forceRefreshToken = false, signal } = {}) {
    const token = await getAccessToken(forceRefreshToken, signal)
    const body = new URLSearchParams({
      image: imageBuffer.toString('base64'),
      language_type: 'CHN_ENG',
      detect_direction: 'true',
      paragraph: 'false',
      probability: 'false'
    }).toString()

    if (Buffer.byteLength(body) > MAX_ENCODED_IMAGE_BYTES) {
      throw createHttpError(413, '合成图片过大，无法提交百度 OCR', 'OCR_IMAGE_TOO_LARGE')
    }

    const url = new URL(endpoint)
    url.searchParams.set('access_token', token)
    const data = await requestJson(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      },
      body,
      timeout: 30000,
      signal
    })
    return { data, token }
  }

  async function recognizeAmount(imageBuffer, { signal } = {}) {
    let attempt = await callOcr(imageBuffer, { signal })
    if (attempt.data.error_code === 110 || attempt.data.error_code === 111) {
      const failedTokenIsCurrent = accessToken === attempt.token
      if (failedTokenIsCurrent) {
        accessToken = null
        tokenExpiresAt = 0
      }
      attempt = await callOcr(imageBuffer, { forceRefreshToken: failedTokenIsCurrent, signal })
    }

    const data = attempt.data
    if (data.error_code) {
      const message = data.error_msg ? `百度 OCR 识别失败：${data.error_msg}` : '百度 OCR 识别失败'
      throw createHttpError(502, message, `BAIDU_${data.error_code}`)
    }

    const words = Array.isArray(data.words_result) ? data.words_result.map((item) => item.words).filter(Boolean) : []
    const result = extractReceiptAmount(words)
    if (!result) {
      throw createHttpError(422, '未识别到明确的票据金额，请手动输入', 'AMOUNT_NOT_FOUND')
    }

    return {
      amount: result.value,
      matchedText: result.matchedText,
      wordsCount: words.length
    }
  }

  return { recognizeAmount }
}

module.exports = {
  createBaiduOcrService,
  extractReceiptAmount
}
