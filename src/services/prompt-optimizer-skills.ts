import animationShortSkill from './minimax-h3-skills/3d-animation-short-generator/SKILL.cn.md?raw'
import brandPromoSkill from './minimax-h3-skills/brand-promo-video-generator/SKILL.cn.md?raw'
import coOpGameIntroSkill from './minimax-h3-skills/co-op-game-intro-generator/SKILL.cn.md?raw'
import promptWritingSkill from './minimax-h3-skills/h3-prompt-writing/SKILL.md?raw'
import handdrawnLiveVideoSkill from './minimax-h3-skills/handdrawn-live-video-generator/SKILL.cn.md?raw'
import minimalistProductAdSkill from './minimax-h3-skills/minimalist-product-ad-generator/SKILL.cn.md?raw'
import musicVideoSubtitleSkill from './minimax-h3-skills/mv-subtitle-skill-confirmed/SKILL.cn.md?raw'
import paperCollageExplainerSkill from './minimax-h3-skills/paper-collage-explainer-generator/SKILL.cn.md?raw'
import papercraftStopMotionSkill from './minimax-h3-skills/papercraft-stop-motion-explainer/SKILL.cn.md?raw'
import basePromptWritingGuide from './minimax-h3-docs/VIDEO_PROMPT_WRITING_GUIDE_base_en.md?raw'
import referencePromptWritingGuide from './minimax-h3-docs/VIDEO_PROMPT_WRITING_GUIDE_ref_en.md?raw'

import type { PromptOptimizationMode } from './prompt-optimizer'

export type PromptOptimizerStyleSkillId =
  | 'minimalist-product-ad-generator'
  | '3d-animation-short-generator'
  | 'papercraft-stop-motion-explainer'
  | 'brand-promo-video-generator'
  | 'music-video-subtitle-generator'
  | 'co-op-game-intro-generator'
  | 'paper-collage-explainer-generator'
  | 'handdrawn-live-video-generator'

export interface PromptOptimizerSkillSelection {
  useBasePromptWritingSkill: boolean
  styleSkillId: PromptOptimizerStyleSkillId | null
}

export interface PromptOptimizerStyleSkillOption {
  label: string
  value: PromptOptimizerStyleSkillId
  description: string
}

export const DEFAULT_PROMPT_OPTIMIZER_SKILL_SELECTION: PromptOptimizerSkillSelection = {
  useBasePromptWritingSkill: false,
  styleSkillId: null,
}

export const H3_PROMPT_WRITING_SKILL_DESCRIPTION =
  '按当前 H3 模式加载对应的官方 Base 或 Ref 指南，并替代“AI 设置”中的提示词优化系统提示词。'

export const PROMPT_OPTIMIZER_STYLE_SKILL_OPTIONS: PromptOptimizerStyleSkillOption[] = [
  {
    label: '极简产品广告',
    value: 'minimalist-product-ad-generator',
    description: '适合电商商品、新品发布和强调材质、留白、文字卡点的高级产品短片。',
  },
  {
    label: '3D 动画短片',
    value: '3d-animation-short-generator',
    description: '适合角色驱动的风格化 3D 叙事、连续表演、镜头节拍和原生音频设计。',
  },
  {
    label: '纸艺定格科普',
    value: 'papercraft-stop-motion-explainer',
    description: '适合分层纸雕、立体纸艺布景、手工停格运动和知识讲解。',
  },
  {
    label: '品牌宣传短片',
    value: 'brand-promo-video-generator',
    description: '适合品牌、产品、网站、应用或个人项目的功能展示和宣传叙事。',
  },
  {
    label: '音乐美学 MV / 歌词贴字',
    value: 'music-video-subtitle-generator',
    description: '适合节拍驱动的 MV、歌词空间排版、人物表演和多镜头自然衔接。',
  },
  {
    label: '双人游戏开场',
    value: 'co-op-game-intro-generator',
    description: '适合双角色游戏菜单、玩家信息卡、UI 文案与主菜单交互动效。',
  },
  {
    label: '纸拼贴讲解动画',
    value: 'paper-collage-explainer-generator',
    description: '适合半调纸拼贴、触感停格组装、视觉隐喻和社交媒体讲解画面。',
  },
  {
    label: '手绘 × 实拍视频',
    value: 'handdrawn-live-video-generator',
    description: '适合粗粝发光手绘线条进入实拍空间，并发生接触、变形和追逐运动。',
  },
]

const STYLE_SKILL_CONTENT: Record<PromptOptimizerStyleSkillId, string> = {
  'minimalist-product-ad-generator': minimalistProductAdSkill,
  '3d-animation-short-generator': animationShortSkill,
  'papercraft-stop-motion-explainer': papercraftStopMotionSkill,
  'brand-promo-video-generator': brandPromoSkill,
  'music-video-subtitle-generator': musicVideoSubtitleSkill,
  'co-op-game-intro-generator': coOpGameIntroSkill,
  'paper-collage-explainer-generator': paperCollageExplainerSkill,
  'handdrawn-live-video-generator': handdrawnLiveVideoSkill,
}

const STYLE_SKILL_IDS = new Set<PromptOptimizerStyleSkillId>(
  PROMPT_OPTIMIZER_STYLE_SKILL_OPTIONS.map((option) => option.value),
)

const SKILL_HOST_EXECUTION_CONTRACT = `BTools Skill 执行协议（当官方 Skill 的多轮制作流程与本工具冲突时，以本协议为准）：
1. 当前宿主只执行“把本次用户输入编译为一份最终 MiniMax-H3 英文正式提示词”这一步，不执行完整制片工作流。
2. 官方风格 Skill 中的启动问询、选择卡片、阶段确认、画布编排、图片生成、音视频生成、剪辑、重试与最终媒体交付步骤均不得在本次响应中执行或输出。用户未提供的非关键选项采用与其描述最一致的合理默认值，不向用户反问。
3. 从所选风格 Skill 原文中完整吸收与最终提示词有关的视觉风格、主体保真、构图、动作、镜头、节拍、画面文字、声音、连续性和负向约束；不要输出中间简报、事实表、故事大纲、角色卡、场景卡、分镜表、检查清单或制作建议。
4. 用户本次明确输入和真实参考图片是事实来源。不得把 Skill 中的示例人物、商品、品牌、文案、颜色、故事或占位值当成用户事实。
5. H3 输入模式、目标时长、参考素材关系、官方字段结构和时间格式优先于风格 Skill 的示例格式。不要添加当前 H3 模式不支持的顶层字段。
6. 所有描述性正文使用英文；用户原始台词、歌词和画面文字保持原始语言与内容。不要生成中文审阅版。
7. 最终只返回一个可解析的 JSON 对象，且只包含以下字符串字段：
{"englishPrompt":"complete English prompt"}
不要返回 JSON 之外的任何文字。`

export function normalizePromptOptimizerSkillSelection(
  selection?: Partial<PromptOptimizerSkillSelection> | null,
): PromptOptimizerSkillSelection {
  const requestedStyleSkillId = selection?.styleSkillId

  return {
    useBasePromptWritingSkill: selection?.useBasePromptWritingSkill === true,
    styleSkillId:
      typeof requestedStyleSkillId === 'string' &&
      STYLE_SKILL_IDS.has(requestedStyleSkillId as PromptOptimizerStyleSkillId)
        ? (requestedStyleSkillId as PromptOptimizerStyleSkillId)
        : null,
  }
}

export function getPromptOptimizerStyleSkillOption(
  skillId: PromptOptimizerStyleSkillId | null,
): PromptOptimizerStyleSkillOption | null {
  return (
    PROMPT_OPTIMIZER_STYLE_SKILL_OPTIONS.find((option) => option.value === skillId) ?? null
  )
}

export function buildPromptOptimizerSystemInstruction(options: {
  configuredSystemPrompt: string
  mode: PromptOptimizationMode
  skillSelection?: Partial<PromptOptimizerSkillSelection> | null
}): string {
  const selection = normalizePromptOptimizerSkillSelection(options.skillSelection)

  if (!selection.useBasePromptWritingSkill && !selection.styleSkillId) {
    return options.configuredSystemPrompt
  }

  const sections: string[] = []

  if (selection.useBasePromptWritingSkill) {
    const modeGuide =
      options.mode === 'Ref2VA' ? referencePromptWritingGuide : basePromptWritingGuide
    const guideName = options.mode === 'Ref2VA' ? 'references/ref-en.txt' : 'references/base-en.txt'

    sections.push(
      `以下内容是官方 h3-prompt-writing Skill 原文及当前 ${options.mode} 模式所需的唯一参考指南。启用此 Skill 时，不使用“AI 设置”中的提示词优化系统提示词。`,
      wrapOfficialSkill('h3-prompt-writing/SKILL.md', promptWritingSkill),
      wrapOfficialSkill(`h3-prompt-writing/${guideName}`, modeGuide),
    )
  } else {
    sections.push(options.configuredSystemPrompt)
  }

  if (selection.styleSkillId) {
    sections.push(
      wrapOfficialSkill(
        `${selection.styleSkillId}/SKILL.cn.md`,
        STYLE_SKILL_CONTENT[selection.styleSkillId],
      ),
    )
  }

  sections.push(SKILL_HOST_EXECUTION_CONTRACT)

  return sections.filter((section) => section.trim()).join('\n\n')
}

function wrapOfficialSkill(path: string, content: string): string {
  return `===== BEGIN UNMODIFIED MINIMAX-H3 OFFICIAL SKILL: ${path} =====
${content}
===== END UNMODIFIED MINIMAX-H3 OFFICIAL SKILL: ${path} =====`
}
