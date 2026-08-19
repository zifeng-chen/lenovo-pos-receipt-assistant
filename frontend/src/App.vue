<template>
  <main class="app-shell">
    <aside class="control-panel">
      <header class="brand-header">
        <div class="brand-icon" aria-hidden="true">票</div>
        <div>
          <h1>门店小票打印助手</h1>
          <p>Lenovo Store Receipt Studio</p>
        </div>
      </header>

      <section class="today-card">
        <div class="today-card__header">
          <span class="section-eyebrow">今日销售</span>
          <span class="today-date">{{ displayToday }}</span>
        </div>
        <div class="today-metrics">
          <div class="metric">
            <span class="metric__label">销售笔数</span>
            <strong>{{ todayStats.count }}</strong>
            <span class="metric__unit">笔</span>
          </div>
          <div class="metric-divider"></div>
          <div class="metric metric--amount">
            <span class="metric__label">销售总额</span>
            <strong>{{ formatCurrency(todayStats.total) }}</strong>
          </div>
        </div>
      </section>

      <section class="panel-section entry-section">
        <div class="section-heading">
          <div>
            <span class="section-eyebrow section-eyebrow--dark">快速记账</span>
            <h2>录入销售金额</h2>
          </div>
          <span class="auto-date">自动记录当日</span>
        </div>
        <div class="amount-row">
          <el-input-number
            v-model="saleAmount"
            :min="0.01"
            :precision="2"
            :step="100"
            :controls="false"
            placeholder="0.00"
            class="amount-input"
            @input="markSaleAmountEdited"
            @keyup.enter="saveSale"
          />
          <el-button type="primary" :loading="saving" class="save-button" @click="saveSale">
            保存记录
          </el-button>
        </div>
        <div :class="['ocr-hint', `ocr-hint--${ocrMessageType}`]" aria-live="polite">
          <span v-if="recognizing" class="ocr-spinner" aria-hidden="true"></span>
          <span>{{ ocrMessage }}</span>
          <el-button
            v-if="currentOcrHistoryId"
            link
            type="primary"
            class="ocr-result-link"
            @click="openHistoryDetail(currentOcrHistoryId)"
          >
            查看识别结果
          </el-button>
        </div>
      </section>

      <section class="action-grid" aria-label="图片操作">
        <el-button type="primary" class="action-button action-button--print" @click="printPreview">
          <span class="button-icon">⌁</span> 打印小票
        </el-button>
        <el-button class="action-button" @click="clearImages">
          <span class="button-icon">×</span> 清除图片
        </el-button>
        <el-button class="action-button action-button--download" :loading="downloading" @click="downloadCombined">
          <span class="button-icon">↓</span> 下载组合图
        </el-button>
      </section>

      <section class="panel-section ocr-management-section">
        <div class="section-heading section-heading--compact">
          <div>
            <span class="section-eyebrow section-eyebrow--dark">文字识别</span>
            <h2>百度 OCR 管理</h2>
          </div>
          <span :class="['ocr-config-state', { 'is-ready': ocrConfig.configured }]">
            {{ ocrConfig.configured ? '已配置' : '未配置' }}
          </span>
        </div>
        <p class="ocr-config-summary">
          <template v-if="ocrConfig.configured">
            API Key：{{ ocrConfig.apiKeyMasked }} · {{ ocrConfigSourceLabel }}
          </template>
          <template v-else>请先配置百度智能云文字识别应用凭据</template>
        </p>
        <div class="ocr-management-actions">
          <el-button plain @click="openOcrConfigDialog">配置凭据</el-button>
          <el-button plain @click="openOcrHistoryDialog">识别记录</el-button>
        </div>
      </section>

      <section class="panel-section records-section">
        <div class="section-heading section-heading--compact">
          <div>
            <span class="section-eyebrow section-eyebrow--dark">销售明细</span>
            <h2>最近记录</h2>
          </div>
          <span class="record-count">共 {{ salesList.length }} 条</span>
        </div>
        <el-table
          v-loading="loading"
          :data="salesList"
          height="260"
          class="sales-table"
          empty-text="暂无销售记录"
          row-key="id"
        >
          <el-table-column prop="sale_date" label="日期" width="108" />
          <el-table-column label="金额" min-width="104">
            <template #default="scope">
              <span :class="['table-amount', { 'is-cancelled': scope.row.status === 0 }]">
                {{ formatCurrency(scope.row.amount) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="72" align="center">
            <template #default="scope">
              <span :class="['status-pill', scope.row.status === 1 ? 'status-pill--active' : 'status-pill--cancelled']">
                {{ scope.row.status === 1 ? '正常' : '已撤销' }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="66" align="right">
            <template #default="scope">
              <el-button link :type="scope.row.status === 1 ? 'danger' : 'primary'" @click="toggleSale(scope.row)">
                {{ scope.row.status === 1 ? '撤销' : '恢复' }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>

      <section class="panel-section chart-section">
        <div class="section-heading section-heading--compact">
          <div>
            <span class="section-eyebrow section-eyebrow--dark">销售趋势</span>
            <h2>近 30 天销售额</h2>
          </div>
        </div>
        <div ref="chartRef" class="trend-chart" aria-label="近30天销售额趋势图"></div>
      </section>
    </aside>

    <section class="preview-workspace">
      <header class="preview-header">
        <div>
          <span class="section-eyebrow section-eyebrow--blue">打印预览</span>
          <h2>A4 组合排版</h2>
          <p>将存根与购物小票并排放置，图片会自动等比缩放</p>
        </div>
        <div class="paper-badge"><span></span>A4 · 210 × 297 mm</div>
      </header>

      <div class="paper-stage">
        <div class="a4-preview" aria-label="A4打印预览区">
          <div
            :class="['image-zone', { 'image-zone--dragging': draggingSide === 'stub' }]"
            role="button"
            tabindex="0"
            aria-label="上传存根图片"
            @click="openFilePicker('stub')"
            @keydown.enter="openFilePicker('stub')"
            @keydown.space.prevent="openFilePicker('stub')"
            @dragenter.prevent="draggingSide = 'stub'"
            @dragover.prevent
            @dragleave.prevent="draggingSide = null"
            @drop.prevent="handleDrop('stub', $event)"
          >
            <img v-if="stubImage" :src="stubImage" alt="商务存根预览" />
            <div v-else class="upload-placeholder">
              <div class="upload-mark">+</div>
              <strong>商务存根</strong>
              <span>拖入图片或点击上传</span>
              <small>支持 JPG、PNG、WEBP</small>
            </div>
          </div>

          <div
            :class="['image-zone', { 'image-zone--dragging': draggingSide === 'receipt' }]"
            role="button"
            tabindex="0"
            aria-label="上传购物小票图片"
            @click="openFilePicker('receipt')"
            @keydown.enter="openFilePicker('receipt')"
            @keydown.space.prevent="openFilePicker('receipt')"
            @dragenter.prevent="draggingSide = 'receipt'"
            @dragover.prevent
            @dragleave.prevent="draggingSide = null"
            @drop.prevent="handleDrop('receipt', $event)"
          >
            <img v-if="receiptImage" :src="receiptImage" alt="购物小票预览" />
            <div v-else class="upload-placeholder">
              <div class="upload-mark">+</div>
              <strong>购物小票</strong>
              <span>拖入图片或点击上传</span>
              <small>支持 JPG、PNG、WEBP</small>
            </div>
          </div>
        </div>
      </div>

      <input ref="stubInputRef" type="file" accept="image/*" hidden @change="handleFileSelect('stub', $event)" />
      <input ref="receiptInputRef" type="file" accept="image/*" hidden @change="handleFileSelect('receipt', $event)" />
    </section>

    <el-dialog
      v-model="configDialogVisible"
      title="配置百度智能云文字识别"
      width="min(500px, 92vw)"
      append-to-body
      :close-on-click-modal="!configSaving"
      :close-on-press-escape="!configSaving"
      :show-close="!configSaving"
      @close="resetOcrConfigForm"
    >
      <div class="ocr-config-dialog-summary">
        <span :class="['ocr-config-state', { 'is-ready': ocrConfig.configured }]">
          {{ ocrConfig.configured ? '当前已配置' : '当前未配置' }}
        </span>
        <span v-if="ocrConfig.configured">{{ ocrConfig.apiKeyMasked }}</span>
      </div>
      <el-alert
        title="凭据仅发送到当前门店后端，Secret Key 不会回显；留空字段将保留现有值。"
        type="info"
        :closable="false"
        show-icon
      />
      <el-form label-position="top" class="ocr-config-form" @submit.prevent>
        <el-form-item label="API Key">
          <el-input
            v-model="ocrConfigForm.apiKey"
            autocomplete="off"
            :placeholder="ocrConfig.configured ? '留空以保留当前 API Key' : '请输入 API Key'"
          />
        </el-form-item>
        <el-form-item label="Secret Key">
          <el-input
            v-model="ocrConfigForm.secretKey"
            type="password"
            show-password
            autocomplete="new-password"
            :placeholder="ocrConfig.hasSecretKey ? '留空以保留当前 Secret Key' : '请输入 Secret Key'"
          />
        </el-form-item>
      </el-form>
      <p class="ocr-config-security-note">
        保存前会向百度验证凭据；数据库仅保存 AES-256-GCM 密文。此系统无登录功能，只能部署在可信门店内网。
      </p>
      <template #footer>
        <el-button :disabled="configSaving" @click="closeOcrConfigDialog">取消</el-button>
        <el-button type="primary" :loading="configSaving" @click="saveOcrConfig">验证并保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="historyDialogVisible"
      title="OCR 识别记录"
      width="min(860px, 94vw)"
      append-to-body
      @close="cancelHistoryRequests"
    >
      <el-table
        v-loading="historyLoading"
        :data="ocrHistory.items"
        height="420"
        class="ocr-history-table"
        empty-text="暂无识别记录"
        row-key="id"
        @row-click="handleHistoryRowClick"
      >
        <el-table-column label="时间" min-width="155">
          <template #default="scope">{{ formatHistoryTime(scope.row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="84">
          <template #default="scope">
            <span :class="['history-status', `history-status--${scope.row.status}`]">
              {{ historyStatusLabel(scope.row.status) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="110">
          <template #default="scope">{{ scope.row.amount ? formatCurrency(scope.row.amount) : '—' }}</template>
        </el-table-column>
        <el-table-column prop="matchedText" label="命中文本" min-width="180" show-overflow-tooltip />
        <el-table-column label="耗时" width="86">
          <template #default="scope">{{ scope.row.durationMs }}ms</template>
        </el-table-column>
        <el-table-column label="操作" width="70" align="right">
          <template #default="scope">
            <el-button link type="primary" @click.stop="openHistoryDetail(scope.row.id)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="ocr-history-pagination">
        <el-pagination
          background
          layout="total, prev, pager, next"
          :total="ocrHistory.total"
          :page-size="ocrHistory.pageSize"
          :current-page="ocrHistory.page"
          @current-change="changeHistoryPage"
        />
      </div>
    </el-dialog>

    <el-dialog
      v-model="detailDialogVisible"
      title="识别结果详情"
      width="min(680px, 94vw)"
      append-to-body
      @close="cancelHistoryDetail"
    >
      <div v-loading="detailLoading" class="ocr-detail">
        <template v-if="selectedHistory">
          <div class="ocr-detail-grid">
            <div><span>记录编号</span><strong>#{{ selectedHistory.id }}</strong></div>
            <div><span>识别时间</span><strong>{{ formatHistoryTime(selectedHistory.createdAt) }}</strong></div>
            <div><span>状态</span><strong>{{ historyStatusLabel(selectedHistory.status) }}</strong></div>
            <div><span>耗时</span><strong>{{ selectedHistory.durationMs }}ms</strong></div>
            <div><span>识别金额</span><strong>{{ selectedHistory.amount ? formatCurrency(selectedHistory.amount) : '—' }}</strong></div>
            <div><span>文字行数</span><strong>{{ selectedHistory.wordsCount }}</strong></div>
          </div>
          <div v-if="selectedHistory.matchedText" class="ocr-detail-block">
            <span>金额命中文本</span>
            <p>{{ selectedHistory.matchedText }}</p>
          </div>
          <div v-if="selectedHistory.errorMessage" class="ocr-detail-block ocr-detail-block--error">
            <span>失败原因（{{ selectedHistory.errorCode || selectedHistory.httpStatus }}）</span>
            <p>{{ selectedHistory.errorMessage }}</p>
          </div>
          <div class="ocr-detail-block">
            <span>百度 OCR 识别文字</span>
            <pre>{{ selectedHistory.recognizedText || '未返回可保存的识别文字' }}</pre>
          </div>
        </template>
      </div>
    </el-dialog>
  </main>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import * as echarts from 'echarts'
import html2canvas from 'html2canvas'
import api from './api'

const stubImage = ref(null)
const receiptImage = ref(null)
const saleAmount = ref(null)
const salesList = ref([])
const trendData = ref([])
const todayStats = ref({ count: 0, total: 0 })
const chartRef = ref(null)
const stubInputRef = ref(null)
const receiptInputRef = ref(null)
const draggingSide = ref(null)
const loading = ref(false)
const saving = ref(false)
const downloading = ref(false)
const recognizing = ref(false)
const ocrMessage = ref('上传两张图片后自动识别销售金额')
const ocrMessageType = ref('neutral')
const currentOcrHistoryId = ref(null)
const ocrConfig = ref({
  configured: false,
  apiKeyMasked: '',
  hasSecretKey: false,
  source: 'none',
  version: 0,
  updatedAt: null,
  storageError: false
})
const configDialogVisible = ref(false)
const configSaving = ref(false)
const ocrConfigForm = ref({ apiKey: '', secretKey: '' })
const historyDialogVisible = ref(false)
const historyLoading = ref(false)
const ocrHistory = ref({ items: [], total: 0, page: 1, pageSize: 10, totalPages: 1 })
const detailDialogVisible = ref(false)
const detailLoading = ref(false)
const selectedHistory = ref(null)
const ocrConfigSourceLabel = computed(() => {
  if (ocrConfig.value.source === 'database') return '页面持久化配置'
  if (ocrConfig.value.source === 'environment') return '后端环境配置'
  return '未配置'
})
let chartInstance = null
let releasePrintResource = null
let ocrAbortController = null
let ocrRequestId = 0
let saleAmountEditVersion = 0
let saleAmountManuallyEdited = false
let historyRequestId = 0
let historyAbortController = null
let detailRequestId = 0
let detailAbortController = null
const imageReadVersions = { stub: 0, receipt: 0 }

const markSaleAmountEdited = () => {
  saleAmountManuallyEdited = true
  saleAmountEditVersion += 1
}

const cancelActiveOcr = () => {
  ocrRequestId += 1
  ocrAbortController?.abort()
  ocrAbortController = null
  recognizing.value = false
  currentOcrHistoryId.value = null
}

const formatReceiptTimestamp = (date = new Date()) => {
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds()
  ]
  return parts.map((part, index) => (index === 0 ? String(part) : String(part).padStart(2, '0'))).join('')
}

const displayToday = new Intl.DateTimeFormat('zh-CN', {
  month: 'long',
  day: 'numeric',
  weekday: 'short'
}).format(new Date())

const formatCurrency = (value) =>
  new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2
  }).format(Number(value) || 0)

const errorMessage = (error, fallback) => error.response?.data?.message || fallback

const formatHistoryTime = (value) => {
  if (!value) return '—'
  const date = new Date(`${String(value).replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date)
}

const historyStatusLabel = (status) => {
  if (status === 'success') return '成功'
  if (status === 'cancelled') return '已取消'
  return '失败'
}

const fetchOcrConfig = async () => {
  const { data } = await api.get('/ocr/config')
  ocrConfig.value = data
  return data
}

const resetOcrConfigForm = () => {
  ocrConfigForm.value = { apiKey: '', secretKey: '' }
}

const closeOcrConfigDialog = () => {
  resetOcrConfigForm()
  configDialogVisible.value = false
}

const openOcrConfigDialog = async () => {
  try {
    await fetchOcrConfig()
    resetOcrConfigForm()
    configDialogVisible.value = true
  } catch (error) {
    ElMessage.error(errorMessage(error, 'OCR 配置状态加载失败'))
  }
}

const saveOcrConfig = async () => {
  const apiKey = ocrConfigForm.value.apiKey.trim()
  const secretKey = ocrConfigForm.value.secretKey.trim()
  if (!apiKey && !secretKey) {
    ElMessage.warning('请至少填写 API Key 或 Secret Key')
    return
  }

  configSaving.value = true
  try {
    const { data } = await api.put(
      '/ocr/config',
      {
        apiKey: apiKey || undefined,
        secretKey: secretKey || undefined,
        version: ocrConfig.value.version
      },
      { timeout: 30000 }
    )
    ocrConfig.value = data
    resetOcrConfigForm()
    configDialogVisible.value = false
    ElMessage.success('百度 OCR 凭据已验证并加密保存')
  } catch (error) {
    if (error.response?.status === 409) {
      try {
        await fetchOcrConfig()
      } catch (refreshError) {
        console.error(refreshError)
      }
    }
    ElMessage.error(errorMessage(error, '百度 OCR 凭据保存失败'))
  } finally {
    configSaving.value = false
  }
}

const cancelHistoryRequests = () => {
  historyRequestId += 1
  historyAbortController?.abort()
  historyAbortController = null
  historyLoading.value = false
}

const fetchOcrHistory = async (page = ocrHistory.value.page) => {
  const requestId = ++historyRequestId
  historyAbortController?.abort()
  const controller = new AbortController()
  historyAbortController = controller
  historyLoading.value = true
  try {
    const { data } = await api.get('/ocr/history', {
      params: { page, pageSize: ocrHistory.value.pageSize },
      signal: controller.signal
    })
    if (requestId !== historyRequestId) return false
    ocrHistory.value = data
    return true
  } catch (error) {
    if (requestId !== historyRequestId || error.code === 'ERR_CANCELED') return false
    throw error
  } finally {
    if (requestId === historyRequestId) {
      historyLoading.value = false
      historyAbortController = null
    }
  }
}

const openOcrHistoryDialog = async () => {
  historyDialogVisible.value = true
  ocrHistory.value = { ...ocrHistory.value, page: 1 }
  try {
    await fetchOcrHistory(1)
  } catch (error) {
    ElMessage.error(errorMessage(error, 'OCR 识别记录加载失败'))
  }
}

const changeHistoryPage = async (page) => {
  ocrHistory.value = { ...ocrHistory.value, page }
  try {
    await fetchOcrHistory(page)
  } catch (error) {
    ElMessage.error(errorMessage(error, 'OCR 识别记录加载失败'))
  }
}

const cancelHistoryDetail = () => {
  detailRequestId += 1
  detailAbortController?.abort()
  detailAbortController = null
  detailLoading.value = false
  selectedHistory.value = null
}

const openHistoryDetail = async (id) => {
  if (!id) return
  const requestId = ++detailRequestId
  detailAbortController?.abort()
  const controller = new AbortController()
  detailAbortController = controller
  detailDialogVisible.value = true
  detailLoading.value = true
  selectedHistory.value = null
  try {
    const { data } = await api.get(`/ocr/history/${id}`, { signal: controller.signal })
    if (requestId !== detailRequestId) return
    selectedHistory.value = data
  } catch (error) {
    if (requestId !== detailRequestId || error.code === 'ERR_CANCELED') return
    detailDialogVisible.value = false
    ElMessage.error(errorMessage(error, '识别结果详情加载失败'))
  } finally {
    if (requestId === detailRequestId) {
      detailLoading.value = false
      detailAbortController = null
    }
  }
}

const handleHistoryRowClick = (row) => openHistoryDetail(row.id)

const fetchSales = async () => {
  const { data } = await api.get('/sales')
  salesList.value = data
}

const fetchTrend = async () => {
  const { data } = await api.get('/sales/trend')
  trendData.value = data
  updateChart()
}

const fetchTodayStats = async () => {
  const { data } = await api.get('/sales/today')
  todayStats.value = data
}

const refreshDashboard = async () => {
  await Promise.all([fetchSales(), fetchTrend(), fetchTodayStats()])
}

const saveSale = async () => {
  const amount = Number(saleAmount.value)
  if (!Number.isFinite(amount) || amount <= 0) {
    ElMessage.warning('请输入大于 0 的销售金额')
    return
  }

  saving.value = true
  try {
    await api.post('/sales', { amount })
    saleAmount.value = null
    saleAmountManuallyEdited = false
    ElMessage.success('销售记录已保存')
  } catch (error) {
    ElMessage.error(errorMessage(error, '保存失败，请检查后端服务'))
    saving.value = false
    return
  }

  try {
    await refreshDashboard()
  } catch (error) {
    console.error(error)
    ElMessage.warning('记录已保存，但统计刷新失败，请稍后刷新页面')
  } finally {
    saving.value = false
  }
}

const toggleSale = async (sale) => {
  const originalStatus = sale.status
  try {
    const { data } = await api.put(`/sales/${sale.id}/toggle`)
    Object.assign(sale, data)
    ElMessage.success(originalStatus === 1 ? '记录已撤销' : '记录已恢复')
  } catch (error) {
    ElMessage.error(errorMessage(error, '操作失败，请稍后重试'))
    return
  }

  try {
    await refreshDashboard()
  } catch (error) {
    console.error(error)
    ElMessage.warning('状态已更新，但统计刷新失败，请稍后刷新页面')
  }
}

const openFilePicker = (side) => {
  const input = side === 'stub' ? stubInputRef.value : receiptInputRef.value
  input?.click()
}

const readImage = (side, file) => {
  if (!file?.type.startsWith('image/')) {
    ElMessage.warning('请选择有效的图片文件')
    return
  }
  if (file.size > 20 * 1024 * 1024) {
    ElMessage.warning('单张图片不能超过 20MB')
    return
  }

  cancelActiveOcr()
  const readVersion = ++imageReadVersions[side]
  ocrMessage.value = '正在读取图片...'
  ocrMessageType.value = 'loading'

  const reader = new FileReader()
  reader.onload = (event) => {
    if (readVersion !== imageReadVersions[side]) return
    if (side === 'stub') stubImage.value = event.target.result
    else receiptImage.value = event.target.result
    void nextTick().then(() => recognizeAmountAutomatically())
  }
  reader.onerror = () => {
    if (readVersion !== imageReadVersions[side]) return
    ocrMessage.value = '图片读取失败，请重新选择'
    ocrMessageType.value = 'error'
    ElMessage.error('图片读取失败，请重新选择')
  }
  reader.readAsDataURL(file)
}

const handleDrop = (side, event) => {
  draggingSide.value = null
  readImage(side, event.dataTransfer.files[0])
}

const handleFileSelect = (side, event) => {
  readImage(side, event.target.files[0])
  event.target.value = ''
}

const clearImages = () => {
  const hadImages = Boolean(stubImage.value || receiptImage.value)
  imageReadVersions.stub += 1
  imageReadVersions.receipt += 1
  cancelActiveOcr()
  ocrMessage.value = '上传两张图片后自动识别销售金额'
  ocrMessageType.value = 'neutral'

  if (!hadImages) {
    ElMessage.info('预览区暂无图片')
    return
  }
  stubImage.value = null
  receiptImage.value = null
  ElMessage.success('图片已清除')
}

const ensureImagesReady = () => {
  if (!stubImage.value || !receiptImage.value) {
    ElMessage.warning('请先上传存根和小票两张图片')
    return false
  }
  return true
}

const waitForPreviewImages = async () => {
  const expectedSources = [stubImage.value, receiptImage.value]
  await nextTick()
  const previewElement = document.querySelector('.a4-preview')
  const previewImages = Array.from(previewElement?.querySelectorAll('img') ?? [])

  if (!previewElement || previewImages.length !== 2) {
    throw new Error('预览图片尚未挂载')
  }

  await Promise.all(
    previewImages.map(async (image) => {
      if (typeof image.decode === 'function') {
        try {
          await image.decode()
        } catch (error) {
          if (!image.complete || image.naturalWidth === 0) throw error
        }
      } else if (!image.complete) {
        await new Promise((resolve, reject) => {
          image.addEventListener('load', resolve, { once: true })
          image.addEventListener('error', reject, { once: true })
        })
      }

      if (image.naturalWidth === 0 || image.naturalHeight === 0) {
        throw new Error('预览图片加载失败')
      }
    })
  )

  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  })
  await nextTick()

  const currentImages = Array.from(previewElement.querySelectorAll('img'))
  const sourcesChanged = expectedSources[0] !== stubImage.value || expectedSources[1] !== receiptImage.value
  const elementsChanged = currentImages.length !== 2 || currentImages.some((image, index) => image !== previewImages[index])
  if (sourcesChanged || elementsChanged) {
    throw new Error('预览图片已发生变化')
  }

  return previewElement
}

const renderPreviewCanvas = async ({ scale = 2, targetWidth = 0, removePaperBorder = false } = {}) => {
  const previewElement = await waitForPreviewImages()
  const previewRect = previewElement.getBoundingClientRect()
  const previewWidth = Math.max(previewRect.width, 1)
  const renderScale = targetWidth > 0 ? Math.max(scale, targetWidth / previewWidth) : scale
  const imageLayouts = Array.from(previewElement.querySelectorAll('.image-zone')).map((zone, index) => {
    const image = zone.querySelector('img')
    if (!image) throw new Error('预览图片节点缺失')

    const imageRect = image.getBoundingClientRect()
    const zoneRect = zone.getBoundingClientRect()
    const zoneStyle = window.getComputedStyle(zone)
    const borderLeft = Number.parseFloat(zoneStyle.borderLeftWidth) || 0
    const borderTop = Number.parseFloat(zoneStyle.borderTopWidth) || 0
    const containScale = Math.min(imageRect.width / image.naturalWidth, imageRect.height / image.naturalHeight)
    const width = image.naturalWidth * containScale
    const height = image.naturalHeight * containScale
    const paintedLeft = imageRect.left + (imageRect.width - width) / 2
    const paintedTop = index === 0 ? imageRect.bottom - height : imageRect.top

    return {
      left: paintedLeft - zoneRect.left - borderLeft,
      top: paintedTop - zoneRect.top - borderTop,
      width,
      height
    }
  })

  return html2canvas(previewElement, {
    scale: renderScale,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    onclone: (clonedDocument) => {
      const preview = clonedDocument.querySelector('.a4-preview')
      const zones = Array.from(preview?.querySelectorAll('.image-zone') ?? [])

      preview?.style.setProperty('width', `${previewRect.width}px`, 'important')
      preview?.style.setProperty('height', `${previewRect.height}px`, 'important')
      preview?.style.setProperty('aspect-ratio', 'auto', 'important')

      if (removePaperBorder) {
        preview?.style.setProperty('border-color', 'transparent', 'important')
        preview?.style.setProperty('box-shadow', 'none', 'important')
      }

      zones.forEach((zone, index) => {
        const image = zone.querySelector('img')
        const layout = imageLayouts[index]

        zone.classList.remove('image-zone--dragging')
        zone.style.setProperty('position', 'relative', 'important')
        zone.style.setProperty('background', '#ffffff', 'important')
        zone.style.setProperty('box-shadow', 'none', 'important')
        zone.style.setProperty('outline', 'none', 'important')

        if (!image || !layout) return
        image.style.setProperty('position', 'absolute', 'important')
        image.style.setProperty('left', `${layout.left}px`, 'important')
        image.style.setProperty('top', `${layout.top}px`, 'important')
        image.style.setProperty('width', `${layout.width}px`, 'important')
        image.style.setProperty('height', `${layout.height}px`, 'important')
        image.style.setProperty('min-width', '0', 'important')
        image.style.setProperty('min-height', '0', 'important')
        image.style.setProperty('max-width', 'none', 'important')
        image.style.setProperty('max-height', 'none', 'important')
        image.style.setProperty('margin', '0', 'important')
        image.style.setProperty('object-fit', 'fill', 'important')
        image.style.setProperty('object-position', '50% 50%', 'important')
        image.style.setProperty('transform', 'none', 'important')
      })

      const divider = preview?.querySelector('.image-zone + .image-zone')
      divider?.style.setProperty('border-left-color', 'transparent', 'important')
    }
  })
}

const canvasToBlob = (canvas, type = 'image/png', quality) =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('组合图片生成失败'))
      },
      type,
      quality
    )
  })

const canvasToPngBlob = (canvas) => canvasToBlob(canvas, 'image/png')

const recognizeAmountAutomatically = async () => {
  const requestId = ++ocrRequestId
  ocrAbortController?.abort()
  ocrAbortController = null

  if (!stubImage.value || !receiptImage.value) {
    recognizing.value = false
    ocrMessage.value = '请继续上传另一张图片，上传完成后将自动识别金额'
    ocrMessageType.value = 'neutral'
    return
  }

  const controller = new AbortController()
  const editVersionAtStart = saleAmountEditVersion
  const manuallyEditedAtStart = saleAmountManuallyEdited
  ocrAbortController = controller
  recognizing.value = true
  ocrMessage.value = '正在合成票据并识别金额...'
  ocrMessageType.value = 'loading'

  try {
    const canvas = await renderPreviewCanvas({ targetWidth: 1600, removePaperBorder: true })
    if (requestId !== ocrRequestId) return

    const imageBlob = await canvasToBlob(canvas, 'image/jpeg', 0.88)
    const { data } = await api.post('/ocr/amount', imageBlob, {
      headers: { 'Content-Type': 'image/jpeg' },
      timeout: 45000,
      signal: controller.signal
    })
    if (requestId !== ocrRequestId) return

    const amount = Number(data.amount)
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('OCR 返回了无效金额')
    currentOcrHistoryId.value = data.historyId || null

    const canFillAutomatically =
      !manuallyEditedAtStart && !saleAmountManuallyEdited && saleAmountEditVersion === editVersionAtStart
    if (canFillAutomatically) {
      saleAmount.value = amount
      ocrMessage.value = `已自动识别金额：${formatCurrency(amount)}`
      ocrMessageType.value = 'success'
      ElMessage.success('票据金额已自动填入')
    } else {
      ocrMessage.value = `识别金额为 ${formatCurrency(amount)}，已保留手动输入的金额`
      ocrMessageType.value = 'warning'
    }
  } catch (error) {
    if (requestId !== ocrRequestId || error.code === 'ERR_CANCELED') return
    currentOcrHistoryId.value = error.response?.data?.historyId || null
    console.error(error)
    ocrMessage.value = errorMessage(error, '金额识别失败，请手动输入')
    ocrMessageType.value = 'error'
  } finally {
    if (requestId === ocrRequestId) {
      recognizing.value = false
      ocrAbortController = null
      if (historyDialogVisible.value && currentOcrHistoryId.value) {
        void fetchOcrHistory(ocrHistory.value.page).catch((error) => console.error(error))
      }
    }
  }
}

const waitForImageElement = async (image) => {
  if (typeof image.decode === 'function') {
    try {
      await image.decode()
    } catch (error) {
      if (!image.complete || image.naturalWidth === 0) throw error
    }
  } else if (!image.complete) {
    await new Promise((resolve, reject) => {
      image.addEventListener('load', resolve, { once: true })
      image.addEventListener('error', reject, { once: true })
    })
  }

  if (image.naturalWidth === 0 || image.naturalHeight === 0) {
    throw new Error('打印图片加载失败')
  }
}

const printPreview = async () => {
  if (!ensureImagesReady()) return

  releasePrintResource?.()
  releasePrintResource = null

  let printFrame = null
  let printImageUrl = null
  let cleaned = false
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    printFrame?.remove()
    if (printImageUrl) URL.revokeObjectURL(printImageUrl)
    if (releasePrintResource === cleanup) releasePrintResource = null
  }

  try {
    const canvas = await renderPreviewCanvas({ targetWidth: 2480, removePaperBorder: true })
    const printBlob = await canvasToPngBlob(canvas)
    printImageUrl = URL.createObjectURL(printBlob)

    printFrame = document.createElement('iframe')
    printFrame.setAttribute('aria-hidden', 'true')
    printFrame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;border:0;'
    document.body.appendChild(printFrame)

    const frameWindow = printFrame.contentWindow
    const frameDocument = printFrame.contentDocument
    if (!frameWindow || !frameDocument) throw new Error('打印窗口创建失败')

    frameDocument.open()
    frameDocument.write(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>打印小票</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
      width: 209mm;
      height: 296mm;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: #ffffff;
    }
    .print-sheet {
      width: 209mm;
      height: 296mm;
      margin: 0;
      padding: 0;
      overflow: hidden;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    #print-image {
      display: block;
      width: 100%;
      height: 100%;
      margin: 0;
      object-fit: contain;
    }
  </style>
</head>
<body>
  <div class="print-sheet"><img id="print-image" alt="小票打印内容" /></div>
</body>
</html>`)
    frameDocument.close()

    const printImage = frameDocument.querySelector('#print-image')
    if (!printImage) throw new Error('打印图片节点创建失败')
    printImage.src = printImageUrl
    await waitForImageElement(printImage)
    await new Promise((resolve) => {
      frameWindow.requestAnimationFrame(() => frameWindow.requestAnimationFrame(resolve))
    })

    releasePrintResource = cleanup
    frameWindow.focus()
    frameWindow.print()
  } catch (error) {
    cleanup()
    console.error(error)
    ElMessage.error('打印内容生成失败，请稍后重试')
  }
}

const downloadCombined = async () => {
  if (!ensureImagesReady()) return
  downloading.value = true
  try {
    const canvas = await renderPreviewCanvas({ targetWidth: 2480 })
    const link = document.createElement('a')
    link.download = `票据${formatReceiptTimestamp()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
    ElMessage.success('组合图已下载')
  } catch (error) {
    console.error(error)
    ElMessage.error('组合图生成失败，请重试')
  } finally {
    downloading.value = false
  }
}

const updateChart = () => {
  if (!chartInstance) return
  chartInstance.setOption({
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) => formatCurrency(value)
    },
    grid: { left: 10, right: 12, top: 18, bottom: 6, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: trendData.value.map((item) => item.date.slice(5)),
      axisLine: { lineStyle: { color: '#dce3ef' } },
      axisTick: { show: false },
      axisLabel: { color: '#8792a5', fontSize: 10, interval: 4 }
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      splitLine: { lineStyle: { color: '#edf1f7', type: 'dashed' } },
      axisLabel: {
        color: '#8792a5',
        fontSize: 10,
        formatter: (value) => (value >= 10000 ? `${value / 10000}万` : value)
      }
    },
    series: [
      {
        name: '销售额',
        type: 'line',
        smooth: true,
        showSymbol: false,
        symbolSize: 7,
        lineStyle: { width: 3, color: '#3370ff' },
        itemStyle: { color: '#3370ff', borderColor: '#ffffff', borderWidth: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(51, 112, 255, 0.25)' },
            { offset: 1, color: 'rgba(51, 112, 255, 0.01)' }
          ])
        },
        data: trendData.value.map((item) => item.total)
      }
    ]
  })
}

const resizeChart = () => chartInstance?.resize()

onMounted(async () => {
  chartInstance = echarts.init(chartRef.value)
  updateChart()
  window.addEventListener('resize', resizeChart)
  loading.value = true
  const [dashboardResult, configResult] = await Promise.allSettled([refreshDashboard(), fetchOcrConfig()])
  if (dashboardResult.status === 'rejected') {
    ElMessage.error(errorMessage(dashboardResult.reason, '数据加载失败，请确认后端服务已启动'))
  }
  if (configResult.status === 'rejected') {
    ElMessage.warning(errorMessage(configResult.reason, 'OCR 配置状态加载失败'))
  }
  loading.value = false
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeChart)
  ocrRequestId += 1
  ocrAbortController?.abort()
  cancelHistoryRequests()
  cancelHistoryDetail()
  resetOcrConfigForm()
  releasePrintResource?.()
  chartInstance?.dispose()
})
</script>
