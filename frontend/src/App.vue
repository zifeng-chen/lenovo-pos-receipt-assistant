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
          {{ ocrMessage }}
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
  </main>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
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
let chartInstance = null
let releasePrintResource = null
let ocrAbortController = null
let ocrRequestId = 0
let saleAmountEditVersion = 0
let saleAmountManuallyEdited = false
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
    console.error(error)
    ocrMessage.value = errorMessage(error, '金额识别失败，请手动输入')
    ocrMessageType.value = 'error'
  } finally {
    if (requestId === ocrRequestId) {
      recognizing.value = false
      ocrAbortController = null
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
  try {
    await refreshDashboard()
  } catch (error) {
    ElMessage.error(errorMessage(error, '数据加载失败，请确认后端服务已启动'))
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeChart)
  ocrRequestId += 1
  ocrAbortController?.abort()
  releasePrintResource?.()
  chartInstance?.dispose()
})
</script>
