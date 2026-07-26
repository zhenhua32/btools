export type PromptLanguage = 'bilingual' | 'zh' | 'en'

export interface PromptTerm {
  id: string
  zh: string
  en: string
}

export interface PromptCategory {
  id: string
  nameZh: string
  nameEn: string
  icon: string
  terms: PromptTerm[]
  custom?: boolean
}

export interface SelectedPrompt {
  categoryId: string
  categoryNameZh: string
  categoryNameEn: string
  term: PromptTerm
}

export interface PromptCategoryGroup {
  category: PromptCategory
  terms: PromptTerm[]
}

function term(id: string, zh: string, en: string): PromptTerm {
  return { id, zh, en }
}

export const DEFAULT_PROMPT_CATEGORIES: PromptCategory[] = [
  {
    id: 'subject',
    nameZh: '主体身份与成年信息',
    nameEn: 'Subject & Adult Identity',
    icon: 'i-carbon-user-avatar-filled',
    terms: [
      term('subject-01', '一位25岁的成年女性摄影师', 'a 25-year-old adult female photographer'),
      term('subject-02', '一位30岁的成年男性建筑师', 'a 30-year-old adult male architect'),
      term('subject-03', '一位优雅的成年芭蕾舞者', 'an elegant adult ballet dancer'),
      term('subject-04', '一位年长睿智的探险家', 'a wise elderly explorer'),
      term('subject-05', '一位自信的成年科技创业者', 'a confident adult tech entrepreneur'),
      term('subject-06', '一位留着银色短发的成年女性', 'an adult woman with short silver hair'),
      term('subject-07', '一位戴圆框眼镜的成年学者', 'an adult scholar wearing round glasses'),
      term('subject-08', '一位面容坚毅的成年宇航员', 'a strong-featured adult astronaut'),
      term('subject-09', '一对成年情侣', 'an adult couple'),
      term('subject-10', '一位经验丰富的成年厨师', 'an experienced adult chef'),
      term('subject-11', '一位充满活力的成年街舞者', 'an energetic adult street dancer'),
      term('subject-12', '一位神秘的成年旅行者', 'a mysterious adult traveler'),
      term('subject-13', '一位成熟稳重的成年企业家', 'a composed adult business leader'),
      term('subject-14', '一位气质温柔的成年艺术家', 'a gentle-looking adult artist'),
    ],
  },
  {
    id: 'scene',
    nameZh: '场景与时段',
    nameEn: 'Scene & Time',
    icon: 'i-carbon-mountain',
    terms: [
      term('scene-01', '清晨薄雾中的森林小径', 'a forest trail in the early morning mist'),
      term('scene-02', '雨后的霓虹都市街头', 'a neon-lit city street after rain'),
      term('scene-03', '日落时分的金色海岸', 'a golden coastline at sunset'),
      term('scene-04', '午夜安静的复古图书馆', 'a quiet vintage library at midnight'),
      term('scene-05', '午后阳光洒入的极简工作室', 'a minimalist studio filled with afternoon sunlight'),
      term('scene-06', '蓝调时刻的未来主义天台', 'a futuristic rooftop during blue hour'),
      term('scene-07', '白雪覆盖的高山营地', 'a snow-covered alpine campsite'),
      term('scene-08', '烛光摇曳的古老餐厅', 'an old restaurant illuminated by candlelight'),
      term('scene-09', '盛夏正午的地中海小镇', 'a Mediterranean town at midsummer noon'),
      term('scene-10', '黎明前的荒漠公路', 'a desert highway before dawn'),
      term('scene-11', '秋日傍晚的宁静湖畔', 'a tranquil lakeside on an autumn evening'),
      term('scene-12', '充满蒸汽的工业车间', 'a steam-filled industrial workshop'),
      term('scene-13', '漂浮在云层之上的空中花园', 'a floating garden above the clouds'),
      term('scene-14', '夜色中的繁忙港口', 'a busy harbor at night'),
    ],
  },
  {
    id: 'action',
    nameZh: '动作与表情',
    nameEn: 'Action & Expression',
    icon: 'i-carbon-run',
    terms: [
      term('action-01', '自然回眸，带着克制的微笑', 'looking back naturally with a restrained smile'),
      term('action-02', '专注地阅读手中的旧信', 'carefully reading an old letter'),
      term('action-03', '迎着风大步向前', 'striding forward against the wind'),
      term('action-04', '闭上双眼感受阳光', 'eyes closed, feeling the warmth of sunlight'),
      term('action-05', '直视镜头，神情坚定', 'looking directly into the camera with determination'),
      term('action-06', '轻扶帽檐，露出自信神态', 'lightly touching the hat brim with a confident expression'),
      term('action-07', '在雨中自由旋转', 'spinning freely in the rain'),
      term('action-08', '低头沉思，情绪内敛', 'looking down in quiet contemplation'),
      term('action-09', '开怀大笑，动作自然', 'laughing openly with natural body language'),
      term('action-10', '整理袖口，姿态从容', 'adjusting a cuff with a composed posture'),
      term('action-11', '快速奔跑，衣摆随风扬起', 'running swiftly with fabric flowing in the wind'),
      term('action-12', '侧身站立，目光望向远方', 'standing in profile and gazing into the distance'),
      term('action-13', '双手捧着热饮，神情放松', 'holding a warm drink with a relaxed expression'),
      term('action-14', '正在创作，捕捉专注瞬间', 'creating something in a candid moment of focus'),
    ],
  },
  {
    id: 'wardrobe',
    nameZh: '服饰与材质',
    nameEn: 'Wardrobe & Material',
    icon: 'i-carbon-shopping-bag',
    terms: [
      term('wardrobe-01', '剪裁利落的黑色羊毛西装', 'a sharply tailored black wool suit'),
      term('wardrobe-02', '轻盈飘动的白色亚麻长裙', 'a flowing white linen dress'),
      term('wardrobe-03', '做旧棕色皮夹克与纯棉内搭', 'a distressed brown leather jacket with a cotton layer'),
      term('wardrobe-04', '带细腻刺绣的丝绸礼服', 'a silk gown with delicate embroidery'),
      term('wardrobe-05', '机能感防水风衣与金属配件', 'a technical waterproof coat with metal accessories'),
      term('wardrobe-06', '柔软宽松的奶油色针织衫', 'a soft oversized cream knit sweater'),
      term('wardrobe-07', '复古牛仔套装与磨砂皮靴', 'a vintage denim set with suede boots'),
      term('wardrobe-08', '半透明欧根纱与层叠薄纱', 'translucent organza with layered tulle'),
      term('wardrobe-09', '极简棉麻长袍', 'a minimalist cotton-linen robe'),
      term('wardrobe-10', '带反光细节的未来感服装', 'futuristic clothing with reflective details'),
      term('wardrobe-11', '深绿色天鹅绒外套', 'a deep green velvet coat'),
      term('wardrobe-12', '手工编织的粗纹理围巾', 'a handwoven scarf with a coarse texture'),
      term('wardrobe-13', '经典白衬衫与高腰长裤', 'a classic white shirt with high-waisted trousers'),
      term('wardrobe-14', '带珠光质感的结构化礼服', 'a structured gown with a pearlescent finish'),
    ],
  },
  {
    id: 'camera',
    nameZh: '景别 / 镜头 / 焦距 / 光圈感',
    nameEn: 'Shot, Lens & Aperture',
    icon: 'i-carbon-camera',
    terms: [
      term('camera-01', '面部特写，85mm人像镜头，浅景深', 'facial close-up, 85mm portrait lens, shallow depth of field'),
      term('camera-02', '半身中近景，50mm标准镜头', 'medium close-up, 50mm standard lens'),
      term('camera-03', '全身环境人像，35mm镜头', 'full-body environmental portrait, 35mm lens'),
      term('camera-04', '超广角远景，16mm镜头，强烈纵深', 'ultra-wide establishing shot, 16mm lens, dramatic depth'),
      term('camera-05', '低机位仰拍，24mm广角镜头', 'low-angle shot with a 24mm wide-angle lens'),
      term('camera-06', '高机位俯拍，画面平整克制', 'high-angle overhead shot with restrained perspective'),
      term('camera-07', '微距特写，细节清晰，柔和虚化', 'macro close-up with crisp detail and soft bokeh'),
      term('camera-08', '长焦压缩感，135mm镜头', 'telephoto compression with a 135mm lens'),
      term('camera-09', '电影感变形宽银幕镜头', 'cinematic anamorphic lens'),
      term('camera-10', '手持纪实镜头，轻微动态模糊', 'handheld documentary shot with subtle motion blur'),
      term('camera-11', '对称正面镜头，f/8清晰景深', 'symmetrical frontal shot with crisp f/8 depth'),
      term('camera-12', '肩后视角，前景自然虚化', 'over-the-shoulder view with natural foreground blur'),
      term('camera-13', '荷兰角构图，制造轻微不安感', 'Dutch-angle framing for subtle unease'),
      term('camera-14', '移轴镜头效果，微缩景观感', 'tilt-shift lens effect with a miniature look'),
    ],
  },
  {
    id: 'lighting',
    nameZh: '光线与色调',
    nameEn: 'Lighting & Color',
    icon: 'i-carbon-light',
    terms: [
      term('lighting-01', '柔和窗光，低对比奶油色调', 'soft window light with a low-contrast creamy palette'),
      term('lighting-02', '戏剧性伦勃朗光，深沉暖色', 'dramatic Rembrandt lighting with deep warm tones'),
      term('lighting-03', '金色逆光，轮廓边缘发亮', 'golden backlight with a glowing rim'),
      term('lighting-04', '冷暖双色霓虹灯光', 'contrasting cyan and magenta neon lighting'),
      term('lighting-05', '阴天漫射光，低饱和灰调', 'overcast diffused light with muted gray tones'),
      term('lighting-06', '明亮高调光线，纯净白色背景', 'bright high-key lighting on a clean white background'),
      term('lighting-07', '低调侧光，浓郁阴影层次', 'low-key side lighting with rich layered shadows'),
      term('lighting-08', '穿过百叶窗的条纹光影', 'striped light and shadow through window blinds'),
      term('lighting-09', '月光般的银蓝色调', 'moonlit silver-blue color palette'),
      term('lighting-10', '落日橙红与深蓝天空形成对比', 'sunset orange-red contrasted with a deep blue sky'),
      term('lighting-11', '顶光形成雕塑般的面部结构', 'top lighting that creates sculptural facial planes'),
      term('lighting-12', '烛光照明，琥珀色高光', 'candlelit illumination with amber highlights'),
      term('lighting-13', '体积光束穿过薄雾', 'volumetric light rays passing through haze'),
      term('lighting-14', '柔和粉彩色调与微妙渐变', 'soft pastel tones with subtle gradients'),
    ],
  },
  {
    id: 'composition',
    nameZh: '构图与主体位置',
    nameEn: 'Composition & Placement',
    icon: 'i-carbon-crop',
    terms: [
      term('composition-01', '三分法构图，主体位于右侧交点', 'rule-of-thirds composition, subject on the right intersection'),
      term('composition-02', '严格居中对称构图', 'strictly centered symmetrical composition'),
      term('composition-03', '大量留白，主体位于画面下方', 'generous negative space with the subject near the bottom'),
      term('composition-04', '前景框景，增强画面层次', 'foreground framing for enhanced visual depth'),
      term('composition-05', '引导线汇聚至主体', 'leading lines converging toward the subject'),
      term('composition-06', '对角线构图，画面富有动势', 'diagonal composition with dynamic movement'),
      term('composition-07', '黄金螺旋构图', 'golden spiral composition'),
      term('composition-08', '主体偏左，为视线方向留出空间', 'subject placed left with looking room'),
      term('composition-09', '多层次前中后景结构', 'layered foreground, middle ground, and background'),
      term('composition-10', '俯视平铺构图，元素整齐排列', 'top-down flat-lay composition with ordered elements'),
      term('composition-11', '打破对称的轻微偏心构图', 'slightly off-center composition that breaks symmetry'),
      term('composition-12', '重复图案中突出唯一主体', 'a single subject emphasized within repeating patterns'),
      term('composition-13', '画中画式门窗框架构图', 'frame-within-a-frame composition using doors or windows'),
      term('composition-14', '紧凑裁切，主体充满画面', 'tight cropping with the subject filling the frame'),
    ],
  },
  {
    id: 'style',
    nameZh: '风格 / 媒介',
    nameEn: 'Style & Medium',
    icon: 'i-carbon-paint-brush',
    terms: [
      term('style-01', '电影级写实摄影', 'cinematic photorealistic photography'),
      term('style-02', '高端时尚杂志大片', 'high-end fashion editorial'),
      term('style-03', '细腻的古典油画', 'finely detailed classical oil painting'),
      term('style-04', '清透水彩插画', 'luminous watercolor illustration'),
      term('style-05', '复古35毫米胶片摄影', 'vintage 35mm film photography'),
      term('style-06', '黑白纪实摄影', 'black-and-white documentary photography'),
      term('style-07', '日系动画电影质感', 'Japanese animated film aesthetic'),
      term('style-08', '精细的铅笔与炭笔素描', 'detailed graphite and charcoal drawing'),
      term('style-09', '未来主义3D数字艺术', 'futuristic 3D digital art'),
      term('style-10', '20世纪中期旅行海报风格', 'mid-century travel poster style'),
      term('style-11', '极简主义平面设计', 'minimalist graphic design'),
      term('style-12', '梦幻超现实主义艺术', 'dreamlike surrealist art'),
      term('style-13', '厚涂丙烯画与可见笔触', 'impasto acrylic painting with visible brushwork'),
      term('style-14', '精致黏土定格动画质感', 'refined clay stop-motion aesthetic'),
    ],
  },
  {
    id: 'constraints',
    nameZh: '细节约束与排斥项',
    nameEn: 'Detail & Negative Constraints',
    icon: 'i-carbon-checkmark-outline',
    terms: [
      term('constraints-01', '自然皮肤纹理，避免过度磨皮', 'natural skin texture, avoid excessive smoothing'),
      term('constraints-02', '双手结构准确，手指数目正确', 'anatomically correct hands and finger count'),
      term('constraints-03', '眼神清晰自然，避免不对称瞳孔', 'clear natural eyes, avoid asymmetrical pupils'),
      term('constraints-04', '服装纹理真实，避免塑料质感', 'realistic fabric texture, avoid a plastic look'),
      term('constraints-05', '背景干净，避免杂乱元素', 'clean background, avoid distracting clutter'),
      term('constraints-06', '无文字、无水印、无品牌标识', 'no text, no watermark, no brand logos'),
      term('constraints-07', '准确的人体比例与自然姿态', 'accurate body proportions and natural posture'),
      term('constraints-08', '细节丰富但不过度锐化', 'rich detail without excessive sharpening'),
      term('constraints-09', '色彩过渡平滑，避免色带断层', 'smooth color transitions, avoid color banding'),
      term('constraints-10', '光影方向一致，反射符合环境', 'consistent light direction and environment-aware reflections'),
      term('constraints-11', '主体边缘清晰，避免重影与重复肢体', 'clean subject edges, avoid ghosting and duplicated limbs'),
      term('constraints-12', '保持面部特征一致', 'maintain consistent facial features'),
      term('constraints-13', '高分辨率细节，避免压缩噪点', 'high-resolution detail, avoid compression artifacts'),
      term('constraints-14', '透视关系准确，避免扭曲背景', 'accurate perspective, avoid warped backgrounds'),
    ],
  },
]

export function clonePromptCategories(
  categories: PromptCategory[] = DEFAULT_PROMPT_CATEGORIES,
): PromptCategory[] {
  return categories.map((category) => ({
    ...category,
    terms: category.terms.map((item) => ({ ...item })),
  }))
}

export function filterPromptCategories(
  categories: PromptCategory[],
  query: string,
  activeCategoryId = 'all',
): PromptCategoryGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()

  return categories
    .filter((category) => activeCategoryId === 'all' || category.id === activeCategoryId)
    .map((category) => {
      const categoryMatches =
        category.nameZh.toLocaleLowerCase().includes(normalizedQuery) ||
        category.nameEn.toLocaleLowerCase().includes(normalizedQuery)
      const terms = !normalizedQuery || categoryMatches
        ? category.terms
        : category.terms.filter(
            (item) =>
              item.zh.toLocaleLowerCase().includes(normalizedQuery) ||
              item.en.toLocaleLowerCase().includes(normalizedQuery),
          )

      return { category, terms }
    })
    .filter((group) => group.terms.length > 0)
}

export function createRandomSelection(
  categories: PromptCategory[],
  enabledCategoryIds: string[],
  random: () => number = Math.random,
): SelectedPrompt[] {
  const enabledIds = new Set(enabledCategoryIds)

  return categories
    .filter((category) => enabledIds.has(category.id) && category.terms.length > 0)
    .map((category) => {
      const index = Math.min(
        category.terms.length - 1,
        Math.floor(Math.max(0, random()) * category.terms.length),
      )

      return {
        categoryId: category.id,
        categoryNameZh: category.nameZh,
        categoryNameEn: category.nameEn,
        term: { ...category.terms[index] },
      }
    })
}

export function composePrompt(
  selection: SelectedPrompt[],
  language: PromptLanguage,
): string {
  if (selection.length === 0) return ''

  const chinese = `${selection.map((item) => item.term.zh).join('，')}。`
  const english = `${selection.map((item) => item.term.en).join(', ')}.`

  if (language === 'zh') return chinese
  if (language === 'en') return english
  return `中文：${chinese}\nEnglish: ${english}`
}

