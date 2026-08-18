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
            @keyup.enter="saveSale"
          />
          <el-button type="primary" :loading="saving" class="save-button" @click="saveSale">
            保存记录
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
let chartInstance = null

const toLocalISODate = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const today = toLocalISODate()
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

  const reader = new FileReader()
  reader.onload = (event) => {
    if (side === 'stub') stubImage.value = event.target.result
    else receiptImage.value = event.target.result
  }
  reader.onerror = () => ElMessage.error('图片读取失败，请重新选择')
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
  if (!stubImage.value && !receiptImage.value) {
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

const printPreview = () => {
  if (!ensureImagesReady()) return
  window.print()
}

const downloadCombined = async () => {
  if (!ensureImagesReady()) return
  downloading.value = true
  try {
    await nextTick()
    const previewElement = document.querySelector('.a4-preview')
    const previewImages = Array.from(previewElement.querySelectorAll('img'))

    await Promise.all(
      previewImages.map(async (image) => {
        if (image.complete && image.naturalWidth > 0) return
        if (typeof image.decode === 'function') {
          await image.decode()
          return
        }
        await new Promise((resolve, reject) => {
          image.addEventListener('load', resolve, { once: true })
          image.addEventListener('error', reject, { once: true })
        })
      })
    )

    const canvas = await html2canvas(previewElement, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      onclone: (clonedDocument) => {
        const divider = clonedDocument.querySelector('.a4-preview .image-zone + .image-zone')
        divider?.style.setProperty('border-left-color', 'transparent', 'important')
      }
    })
    const link = document.createElement('a')
    link.download = `小票组合_${today}.png`
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
  chartInstance?.dispose()
})
</script>
