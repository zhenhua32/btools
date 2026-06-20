<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  NAlert,
  NButton,
  NCard,
  NForm,
  NFormItem,
  NGrid,
  NGi,
  NInputNumber,
  NProgress,
  NSpace,
  NStatistic,
  NText,
} from 'naive-ui'
import {
  DEFAULT_ELO_SCALE_FACTOR,
  calculateExpectedScores,
  calculateRatingDiffByExpectedScore,
} from '@/services/elo-winrate'

const defaultRatingA = 1600
const defaultRatingB = 1500
const defaultTargetPercent = 75
const diffPresets = [0, 50, 100, 200, 400]

const ratingA = ref<number | null>(defaultRatingA)
const ratingB = ref<number | null>(defaultRatingB)
const targetExpectedPercent = ref<number | null>(defaultTargetPercent)
const scaleFactor = ref<number | null>(DEFAULT_ELO_SCALE_FACTOR)

const normalizedRatingA = computed(() =>
  typeof ratingA.value === 'number' ? ratingA.value : defaultRatingA,
)

const normalizedRatingB = computed(() =>
  typeof ratingB.value === 'number' ? ratingB.value : defaultRatingB,
)

const normalizedScaleFactor = computed(() =>
  typeof scaleFactor.value === 'number' && scaleFactor.value > 0
    ? scaleFactor.value
    : DEFAULT_ELO_SCALE_FACTOR,
)

const normalizedTargetPercent = computed(() => {
  const rawValue = typeof targetExpectedPercent.value === 'number'
    ? targetExpectedPercent.value
    : defaultTargetPercent

  return Math.min(99.9, Math.max(0.1, rawValue))
})

const matchup = computed(() =>
  calculateExpectedScores(
    normalizedRatingA.value,
    normalizedRatingB.value,
    normalizedScaleFactor.value,
  ),
)

const expectedScoreAPercent = computed(() => toPercent(matchup.value.expectedScoreA))
const expectedScoreBPercent = computed(() => toPercent(matchup.value.expectedScoreB))

const requiredRatingDiff = computed(() =>
  calculateRatingDiffByExpectedScore(
    normalizedTargetPercent.value / 100,
    normalizedScaleFactor.value,
  ),
)

const suggestedOpponentRating = computed(() => normalizedRatingA.value - requiredRatingDiff.value)

const additionalDiffNeeded = computed(() => requiredRatingDiff.value - matchup.value.ratingDiff)

const targetGapMessage = computed(() => {
  const roundedGap = Math.round(additionalDiffNeeded.value)

  if (roundedGap > 0) {
    return `按当前双方分数，A 还需要再领先约 ${roundedGap} 分才能达到目标胜率。`
  }

  if (roundedGap < 0) {
    return `按当前双方分数，A 已经比目标多领先约 ${Math.abs(roundedGap)} 分。`
  }

  return '按当前双方分数，A 已经刚好达到目标胜率。'
})

function toPercent(value: number): number {
  return Number((value * 100).toFixed(2))
}

function formatRating(value: number): string {
  return `${Math.round(value)} 分`
}

function formatSignedRating(value: number): string {
  const roundedValue = Math.round(value)
  if (roundedValue === 0) return '0 分'
  return `${roundedValue > 0 ? '+' : ''}${roundedValue} 分`
}

function applyDiffPreset(diff: number) {
  ratingB.value = normalizedRatingA.value - diff
}

function resetAll() {
  ratingA.value = defaultRatingA
  ratingB.value = defaultRatingB
  targetExpectedPercent.value = defaultTargetPercent
  scaleFactor.value = DEFAULT_ELO_SCALE_FACTOR
}
</script>

<template>
  <div class="elo-winrate-tool">
    <div class="elo-toolbar">
      <div>
        <NText strong>Elo 胜率计算</NText>
        <div class="elo-toolbar-desc">标准 Elo 期望得分公式，适合快速估算双方分差对应的理论胜率。</div>
      </div>
      <NSpace>
        <NButton size="small" @click="applyDiffPreset(100)">A 领先 100 分</NButton>
        <NButton size="small" @click="resetAll">恢复默认</NButton>
      </NSpace>
    </div>

    <NAlert type="info" :show-icon="false">
      这里的“胜率”使用标准 Elo 期望得分公式
      E = 1 / (1 + 10^((Rb - Ra) / c))。
      结果更接近理论期望得分，没有单独建模平局概率。
    </NAlert>

    <NCard title="根据双方 Elo 分数计算" size="small">
      <NForm label-placement="top">
        <NGrid cols="1 s:2 m:3" responsive="screen" :x-gap="12" :y-gap="12">
          <NGi>
            <NFormItem label="A 分数">
              <NInputNumber v-model:value="ratingA" :step="10" style="width: 100%" />
            </NFormItem>
          </NGi>
          <NGi>
            <NFormItem label="B 分数">
              <NInputNumber v-model:value="ratingB" :step="10" style="width: 100%" />
            </NFormItem>
          </NGi>
          <NGi>
            <NFormItem label="缩放系数 c">
              <NInputNumber
                v-model:value="scaleFactor"
                :min="1"
                :step="10"
                style="width: 100%"
              />
            </NFormItem>
          </NGi>
        </NGrid>
      </NForm>

      <NSpace wrap class="elo-presets">
        <NText depth="3">快捷分差：</NText>
        <NButton v-for="diff in diffPresets" :key="diff" size="tiny" @click="applyDiffPreset(diff)">
          A 领先 {{ diff }} 分
        </NButton>
      </NSpace>

      <NGrid cols="1 s:2 m:4" responsive="screen" :x-gap="12" :y-gap="12" class="elo-stats">
        <NGi>
          <NCard size="small" embedded>
            <NStatistic label="A 理论胜率" :value="`${expectedScoreAPercent}%`" />
          </NCard>
        </NGi>
        <NGi>
          <NCard size="small" embedded>
            <NStatistic label="B 理论胜率" :value="`${expectedScoreBPercent}%`" />
          </NCard>
        </NGi>
        <NGi>
          <NCard size="small" embedded>
            <NStatistic label="当前分差 (A-B)" :value="formatSignedRating(matchup.ratingDiff)" />
          </NCard>
        </NGi>
        <NGi>
          <NCard size="small" embedded>
            <NStatistic label="系数 c" :value="matchup.scaleFactor" />
          </NCard>
        </NGi>
      </NGrid>

      <div class="elo-progress-list">
        <div class="elo-progress-item">
          <div class="elo-progress-header">
            <span>A 理论胜率</span>
            <span>{{ expectedScoreAPercent }}%</span>
          </div>
          <NProgress type="line" :percentage="expectedScoreAPercent" :show-indicator="false" />
        </div>
        <div class="elo-progress-item">
          <div class="elo-progress-header">
            <span>B 理论胜率</span>
            <span>{{ expectedScoreBPercent }}%</span>
          </div>
          <NProgress type="line" :percentage="expectedScoreBPercent" :show-indicator="false" />
        </div>
      </div>
    </NCard>

    <NCard title="按目标胜率反推所需分差" size="small">
      <NForm label-placement="top">
        <NGrid cols="1 s:2" responsive="screen" :x-gap="12" :y-gap="12">
          <NGi>
            <NFormItem label="目标胜率 (%)">
              <NInputNumber
                v-model:value="targetExpectedPercent"
                :min="0.1"
                :max="99.9"
                :step="0.1"
                style="width: 100%"
              />
            </NFormItem>
          </NGi>
          <NGi>
            <NFormItem label="A 当前分数">
              <NInputNumber v-model:value="ratingA" :step="10" style="width: 100%" />
            </NFormItem>
          </NGi>
        </NGrid>
      </NForm>

      <NGrid cols="1 s:2 m:3" responsive="screen" :x-gap="12" :y-gap="12">
        <NGi>
          <NCard size="small" embedded>
            <NStatistic label="达到目标所需分差" :value="formatSignedRating(requiredRatingDiff)" />
          </NCard>
        </NGi>
        <NGi>
          <NCard size="small" embedded>
            <NStatistic label="当 A 固定时，B 约为" :value="formatRating(suggestedOpponentRating)" />
          </NCard>
        </NGi>
        <NGi>
          <NCard size="small" embedded>
            <NStatistic label="目标胜率" :value="`${normalizedTargetPercent}%`" />
          </NCard>
        </NGi>
      </NGrid>

      <div class="elo-target-note">
        {{ targetGapMessage }}
      </div>
    </NCard>
  </div>
</template>

<style scoped>
.elo-winrate-tool {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.elo-toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.elo-toolbar-desc {
  margin-top: 4px;
  color: var(--n-text-color-3, #6b7280);
  font-size: 13px;
}

.elo-presets {
  margin-top: 4px;
}

.elo-stats {
  margin-top: 16px;
}

.elo-progress-list {
  display: grid;
  gap: 12px;
  margin-top: 16px;
}

.elo-progress-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  color: var(--n-text-color-2, #4b5563);
  font-size: 13px;
}

.elo-target-note {
  margin-top: 16px;
  color: var(--n-text-color-2, #4b5563);
  font-size: 13px;
}

@media (max-width: 640px) {
  .elo-toolbar {
    flex-direction: column;
  }
}
</style>