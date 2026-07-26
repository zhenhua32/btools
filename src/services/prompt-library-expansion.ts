import type { PromptCategory, PromptTerm } from './prompt-composer'

type BilingualPair = readonly [zh: string, en: string]

function crossTerms(
  prefix: string,
  left: readonly BilingualPair[],
  right: readonly BilingualPair[],
  combineZh: (left: string, right: string) => string,
  combineEn: (left: string, right: string) => string,
): PromptTerm[] {
  return left.flatMap((leftItem, leftIndex) =>
    right.map((rightItem, rightIndex) => ({
      id: `${prefix}-${leftIndex + 1}-${rightIndex + 1}`,
      zh: combineZh(leftItem[0], rightItem[0]),
      en: combineEn(leftItem[1], rightItem[1]),
    })),
  )
}

const adultProfiles: BilingualPair[] = [
  ['一位25岁的成年女性', 'a 25-year-old adult woman'],
  ['一位28岁的成年男性', 'a 28-year-old adult man'],
  ['一位32岁的成年女性', 'a 32-year-old adult woman'],
  ['一位35岁的成年男性', 'a 35-year-old adult man'],
  ['一位40岁的成年女性', 'a 40-year-old adult woman'],
  ['一位45岁的成年男性', 'a 45-year-old adult man'],
  ['一位气质沉稳的成年女性', 'a composed adult woman'],
  ['一位神情自信的成年男性', 'a confident adult man'],
  ['一位银发的年长成年女性', 'an older adult woman with silver hair'],
  ['一位面容坚毅的年长成年男性', 'an older adult man with strong features'],
]

const adultRoles: BilingualPair[] = [
  ['纪实摄影师', 'documentary photographer'],
  ['现代建筑师', 'modern architect'],
  ['当代舞者', 'contemporary dancer'],
  ['野外探险家', 'wilderness explorer'],
  ['独立电影导演', 'independent film director'],
  ['植物学研究员', 'botanical researcher'],
  ['陶艺工作者', 'ceramic artist'],
  ['爵士音乐家', 'jazz musician'],
  ['高级时装设计师', 'couture fashion designer'],
  ['深空任务宇航员', 'deep-space mission astronaut'],
]

const scenePlaces: BilingualPair[] = [
  ['森林深处的苔藓小径', 'on a mossy trail deep in the forest'],
  ['玻璃幕墙环绕的城市天台', 'on an urban rooftop surrounded by glass towers'],
  ['面向大海的黑色礁石', 'on black coastal rocks facing the ocean'],
  ['藏书丰富的古典图书馆', 'inside a classical library filled with books'],
  ['带巨大窗户的极简工作室', 'inside a minimalist studio with enormous windows'],
  ['霓虹招牌密集的夜市街道', 'on a night-market street filled with neon signs'],
  ['白雪覆盖的高山营地', 'at a snow-covered alpine campsite'],
  ['烛光摇曳的历史餐厅', 'inside a historic restaurant lit by candles'],
  ['地中海山城的石板街巷', 'in the stone lanes of a Mediterranean hill town'],
  ['横穿荒漠的笔直公路', 'on a straight highway crossing the desert'],
  ['倒映群山的宁静湖畔', 'beside a tranquil lake reflecting the mountains'],
  ['漂浮在云海之上的空中花园', 'in a floating garden above a sea of clouds'],
]

const sceneTimes: BilingualPair[] = [
  ['黎明前蓝调时刻', 'during blue hour before dawn'],
  ['清晨薄雾弥漫时', 'in the early morning mist'],
  ['明亮而清澈的上午', 'on a bright and clear morning'],
  ['正午阳光直射时', 'under direct midday sunlight'],
  ['慵懒的夏日下午', 'on a lazy summer afternoon'],
  ['金色夕阳即将落下时', 'as the golden sun is setting'],
  ['暮色刚刚降临时', 'at the onset of dusk'],
  ['深蓝色的午夜', 'at deep-blue midnight'],
  ['细雨刚刚停歇后', 'just after a light rain'],
  ['暴风雪到来之前', 'shortly before a snowstorm'],
]

const actions: BilingualPair[] = [
  ['自然回眸', 'looking back naturally'],
  ['专注地阅读一封旧信', 'carefully reading an old letter'],
  ['迎着强风大步向前', 'striding forward against a strong wind'],
  ['闭上双眼感受阳光', 'closing their eyes and feeling the sunlight'],
  ['直视镜头', 'looking directly into the camera'],
  ['轻轻整理袖口', 'gently adjusting a cuff'],
  ['在雨中自由旋转', 'spinning freely in the rain'],
  ['低头陷入沉思', 'looking down in quiet contemplation'],
  ['双手捧着一杯热饮', 'holding a warm drink in both hands'],
  ['快速奔跑，衣摆扬起', 'running quickly with fabric flowing behind'],
  ['侧身站立并望向远方', 'standing in profile and gazing into the distance'],
  ['伏在桌前投入创作', 'leaning over a desk while creating'],
]

const expressions: BilingualPair[] = [
  ['带着克制而真诚的微笑', 'with a restrained and genuine smile'],
  ['神情平静而专注', 'with a calm and focused expression'],
  ['目光坚定，充满决心', 'with a determined and resolute gaze'],
  ['显得放松而自在', 'appearing relaxed and at ease'],
  ['带着若有所思的神态', 'with a thoughtful expression'],
  ['开怀大笑，情绪自然', 'laughing openly with natural emotion'],
  ['流露出轻微的惊讶', 'showing subtle surprise'],
  ['神秘而难以捉摸', 'appearing mysterious and enigmatic'],
]

const garments: BilingualPair[] = [
  ['剪裁利落的长款西装', 'a sharply tailored long suit'],
  ['轻盈飘动的及踝长裙', 'a flowing ankle-length dress'],
  ['结构感鲜明的短夹克', 'a strongly structured cropped jacket'],
  ['层叠设计的礼服', 'a layered formal gown'],
  ['宽松的高领针织衫', 'an oversized turtleneck sweater'],
  ['复古工装连体裤', 'a vintage utility jumpsuit'],
  ['极简无领长袍', 'a minimalist collarless robe'],
  ['带风帽的机能风衣', 'a hooded technical trench coat'],
  ['高腰阔腿长裤套装', 'a high-waisted wide-leg trouser set'],
  ['不对称剪裁的上衣', 'an asymmetrically cut top'],
  ['手工编织披肩', 'a handwoven shawl'],
  ['带有建筑感轮廓的礼服', 'a gown with an architectural silhouette'],
]

const garmentMaterials: BilingualPair[] = [
  ['采用细密黑色羊毛与哑光纽扣', 'made from fine black wool with matte buttons'],
  ['采用天然白色亚麻与可见织纹', 'made from natural white linen with visible weave'],
  ['采用做旧棕色皮革与黄铜配件', 'made from distressed brown leather with brass hardware'],
  ['采用带细腻刺绣的丝绸面料', 'made from silk with delicate embroidery'],
  ['采用半透明欧根纱与层叠薄纱', 'made from translucent organza and layered tulle'],
  ['采用深色天鹅绒并带柔和光泽', 'made from dark velvet with a soft sheen'],
  ['采用反光科技面料与金属细节', 'made from reflective technical fabric with metal details'],
  ['采用粗纹理棉麻与手工缝线', 'made from coarse cotton-linen with hand stitching'],
]

const shotAngles: BilingualPair[] = [
  ['极近距离面部特写', 'extreme facial close-up'],
  ['肩部以上人像近景', 'head-and-shoulders portrait'],
  ['腰部以上中近景', 'waist-up medium close-up'],
  ['完整全身环境人像', 'full-body environmental portrait'],
  ['展示环境规模的超广远景', 'ultra-wide establishing shot showing environmental scale'],
  ['贴近地面的低机位仰拍', 'ground-level low-angle view'],
  ['垂直向下的高机位俯拍', 'vertical top-down overhead view'],
  ['越过肩膀观察主体的视角', 'over-the-shoulder view toward the subject'],
  ['带轻微倾斜的荷兰角镜头', 'slightly tilted Dutch-angle shot'],
  ['从门窗外侧拍摄的框景视角', 'framed view photographed through a doorway or window'],
  ['突出微小表面细节的微距视角', 'macro view emphasizing minute surface detail'],
  ['平行于地面的侧面跟拍视角', 'side-on tracking perspective parallel to the ground'],
]

const lensTreatments: BilingualPair[] = [
  ['16mm超广角镜头，纵深夸张', '16mm ultra-wide lens with exaggerated depth'],
  ['24mm广角镜头，环境信息丰富', '24mm wide-angle lens with rich environmental context'],
  ['35mm镜头，自然纪实透视', '35mm lens with natural documentary perspective'],
  ['50mm标准镜头，接近人眼观感', '50mm standard lens with a natural field of view'],
  ['85mm人像镜头，浅景深柔和虚化', '85mm portrait lens with shallow depth and soft bokeh'],
  ['135mm长焦镜头，明显空间压缩', '135mm telephoto lens with strong spatial compression'],
  ['移轴镜头，垂直线条保持平直', 'tilt-shift lens with straight vertical lines'],
  ['变形宽银幕镜头，横向光晕', 'anamorphic cinema lens with horizontal flares'],
]

const lightSetups: BilingualPair[] = [
  ['来自左侧窗户的柔和自然光', 'soft natural light from a window on the left'],
  ['单侧伦勃朗主光与微弱补光', 'a single Rembrandt key light with subtle fill'],
  ['落日形成的金色轮廓逆光', 'golden sunset backlight creating a luminous rim'],
  ['冷青与洋红交错的双色霓虹光', 'intersecting cyan and magenta neon lights'],
  ['阴天环境中的均匀漫射光', 'even diffused light under an overcast sky'],
  ['明亮高调棚拍光与纯净背景', 'bright high-key studio light against a clean background'],
  ['低调侧光与大面积深邃阴影', 'low-key side lighting with broad deep shadows'],
  ['穿过百叶窗形成的条纹光影', 'striped light and shadow passing through blinds'],
  ['银蓝色月光与微弱环境反射', 'silver-blue moonlight with subtle ambient reflections'],
  ['琥珀色烛光与跳动高光', 'amber candlelight with flickering highlights'],
  ['从上方落下的雕塑感硬光', 'sculptural hard light falling from above'],
  ['穿过薄雾的可见体积光束', 'visible volumetric light rays passing through haze'],
]

const colorGrades: BilingualPair[] = [
  ['搭配低对比奶油色调', 'with a low-contrast creamy color grade'],
  ['搭配电影感青橙配色', 'with a cinematic teal-and-orange grade'],
  ['搭配低饱和灰蓝色调', 'with a desaturated gray-blue palette'],
  ['搭配浓郁温暖的琥珀色调', 'with rich warm amber tones'],
  ['搭配清冷的银白与深蓝色调', 'with cool silver-white and deep-blue tones'],
  ['搭配柔和粉彩与细腻渐变', 'with soft pastels and delicate gradients'],
  ['搭配高对比黑白影调', 'with high-contrast black-and-white tonality'],
  ['搭配自然肤色与真实白平衡', 'with natural skin tones and realistic white balance'],
]

const compositionStructures: BilingualPair[] = [
  ['遵循三分法组织画面', 'organized with the rule of thirds'],
  ['采用严格的轴线对称构图', 'using strict axial symmetry'],
  ['运用大面积负空间', 'using generous negative space'],
  ['利用前景元素形成框中框', 'using foreground elements as a frame within the frame'],
  ['让引导线汇聚至视觉焦点', 'using leading lines that converge on the visual focus'],
  ['采用充满动势的对角线结构', 'using a dynamic diagonal structure'],
  ['依照黄金螺旋安排视觉节奏', 'arranged along a golden spiral'],
  ['建立清晰的前中后景层次', 'building clear foreground, middle-ground, and background layers'],
  ['在重复图案中设置唯一焦点', 'placing a unique focal point within a repeating pattern'],
  ['采用紧凑裁切让主体充满画面', 'using tight cropping so the subject fills the frame'],
  ['使用平衡但不完全对称的布局', 'using a balanced yet deliberately asymmetrical layout'],
  ['通过S形路径引导观看顺序', 'guiding the viewing order with an S-shaped path'],
]

const subjectPlacements: BilingualPair[] = [
  ['主体位于左侧交点并向右侧留出视线空间', 'with the subject on the left intersection and looking room to the right'],
  ['主体位于右侧交点并向左侧留出动作空间', 'with the subject on the right intersection and action room to the left'],
  ['主体严格居中并与背景轴线对齐', 'with the subject centered and aligned to the background axis'],
  ['主体靠近画面下缘，上方保留大量空间', 'with the subject near the lower edge and ample space above'],
  ['主体占据前景，环境在远处展开', 'with the subject dominating the foreground as the environment unfolds behind'],
  ['主体置于中景，前景保持自然虚化', 'with the subject in the middle ground and a naturally blurred foreground'],
  ['主体只占画面较小比例以突出环境尺度', 'with the subject kept small to emphasize environmental scale'],
]

const artisticMedia: BilingualPair[] = [
  ['电影级写实摄影', 'cinematic photorealistic photography'],
  ['高端时尚杂志摄影', 'high-end fashion editorial photography'],
  ['复古35毫米胶片摄影', 'vintage 35mm film photography'],
  ['细腻古典油画', 'finely rendered classical oil painting'],
  ['透明叠染水彩插画', 'transparent layered watercolor illustration'],
  ['铅笔与炭笔混合素描', 'mixed graphite and charcoal drawing'],
  ['丝网印刷与半调网点海报', 'screen print poster with halftone dots'],
  ['木刻版画', 'woodblock print'],
  ['立体黏土定格动画', 'three-dimensional clay stop-motion'],
  ['精致低多边形3D渲染', 'refined low-poly 3D rendering'],
  ['像素艺术场景', 'pixel-art scene'],
  ['极简矢量平面插画', 'minimal vector graphic illustration'],
]

const styleDirections: BilingualPair[] = [
  ['呈现克制的现代主义视觉语言', 'with a restrained modernist visual language'],
  ['呈现华丽而精密的装饰艺术气质', 'with an ornate and precise Art Deco sensibility'],
  ['呈现柔和梦幻的超现实主义氛围', 'with a soft dreamlike surrealist atmosphere'],
  ['呈现粗粝真实的纪实感', 'with a raw and truthful documentary character'],
  ['呈现20世纪中期复古设计感', 'with a mid-century vintage design sensibility'],
  ['呈现未来主义科技美学', 'with a futuristic technological aesthetic'],
  ['呈现宁静留白的东方极简感', 'with a tranquil East Asian minimalist sensibility'],
  ['呈现充满手工痕迹的质朴气质', 'with a tactile handcrafted and rustic character'],
]

const qualityGoals: BilingualPair[] = [
  ['保持准确自然的人体比例与姿态', 'maintain accurate natural body proportions and posture'],
  ['保持双手结构正确且手指数目准确', 'maintain anatomically correct hands and finger count'],
  ['保持眼神清晰自然与瞳孔方向一致', 'maintain clear natural eyes with consistent pupil direction'],
  ['保持真实皮肤纹理与细微毛孔', 'maintain realistic skin texture and subtle pores'],
  ['保持面部特征在画面中的一致性', 'maintain consistent facial features throughout the image'],
  ['保持服装结构、接缝与材质逻辑准确', 'maintain accurate garment structure, seams, and material behavior'],
  ['保持光源方向、投影与反射关系一致', 'maintain consistent light direction, shadows, and reflections'],
  ['保持透视、尺度与空间关系准确', 'maintain accurate perspective, scale, and spatial relationships'],
  ['保持主体边缘干净且发丝细节自然', 'maintain clean subject edges and natural flyaway hair detail'],
  ['保持高分辨率细节与平滑色彩过渡', 'maintain high-resolution detail and smooth color transitions'],
]

const exclusions: BilingualPair[] = [
  ['避免过度磨皮、蜡像感与塑料质感', 'avoid excessive smoothing, waxy skin, and plastic textures'],
  ['避免重复肢体、额外手指与结构错位', 'avoid duplicated limbs, extra fingers, and structural misalignment'],
  ['避免模糊五官、重影与不对称瞳孔', 'avoid blurred features, ghosting, and asymmetrical pupils'],
  ['避免杂乱背景与无关抢眼元素', 'avoid cluttered backgrounds and unrelated distracting elements'],
  ['避免错误文字、随机字符与乱码', 'avoid incorrect text, random characters, and gibberish'],
  ['避免水印、品牌标识与界面元素', 'avoid watermarks, brand logos, and interface elements'],
  ['避免过度锐化、压缩噪点与色带断层', 'avoid oversharpening, compression noise, and color banding'],
  ['避免扭曲建筑、弯曲直线与不可能的反射', 'avoid warped architecture, bent straight lines, and impossible reflections'],
]

const emotionalTones: BilingualPair[] = [
  ['安静而内省的情绪', 'a quiet and introspective mood'],
  ['明快而充满希望的情绪', 'a bright and hopeful mood'],
  ['神秘而略带不安的情绪', 'a mysterious and subtly uneasy mood'],
  ['温暖怀旧的情绪', 'a warm nostalgic mood'],
  ['宏大庄严的情绪', 'a grand and solemn mood'],
  ['轻盈梦幻的情绪', 'a light and dreamlike mood'],
  ['紧张急迫的情绪', 'a tense and urgent mood'],
  ['亲密柔和的情绪', 'an intimate and tender mood'],
  ['孤独疏离的情绪', 'a lonely and detached mood'],
  ['自由冒险的情绪', 'a free-spirited adventurous mood'],
  ['理性克制的情绪', 'a rational and restrained mood'],
  ['欢乐俏皮的情绪', 'a joyful and playful mood'],
]

const atmosphereLayers: BilingualPair[] = [
  ['伴随轻微空气透视与远景雾化', 'with subtle aerial perspective and softened distance'],
  ['伴随缓慢漂浮的尘埃微粒', 'with slowly drifting dust particles'],
  ['伴随柔和风感与自然流动', 'with a gentle breeze and natural movement'],
  ['伴随电影般的空间层次', 'with cinematic spatial depth'],
  ['伴随安静、几乎停滞的时间感', 'with a quiet sense of nearly suspended time'],
  ['伴随富有故事性的环境细节', 'with story-rich environmental details'],
]

const colorPalettes: BilingualPair[] = [
  ['象牙白、沙色与暖灰构成的中性色板', 'a neutral palette of ivory, sand, and warm gray'],
  ['群青、靛蓝与银色构成的冷色板', 'a cool palette of ultramarine, indigo, and silver'],
  ['赭石、陶土红与橄榄绿构成的大地色板', 'an earthy palette of ochre, terracotta, and olive'],
  ['樱花粉、薰衣草紫与雾蓝构成的粉彩色板', 'a pastel palette of blossom pink, lavender, and mist blue'],
  ['青色、洋红与电光紫构成的霓虹色板', 'a neon palette of cyan, magenta, and electric violet'],
  ['深酒红、墨绿与金色构成的珠宝色板', 'a jewel-tone palette of burgundy, forest green, and gold'],
  ['纯黑、象牙白与单一红色点缀', 'a black-and-ivory palette with a single red accent'],
  ['海军蓝、奶油白与珊瑚橙构成的海岸色板', 'a coastal palette of navy, cream, and coral'],
  ['薄荷绿、柠檬黄与天空蓝构成的清新色板', 'a fresh palette of mint, lemon yellow, and sky blue'],
  ['焦糖棕、琥珀与铜色构成的暖色板', 'a warm palette of caramel brown, amber, and copper'],
  ['水泥灰、钢铁蓝与冷白构成的工业色板', 'an industrial palette of concrete gray, steel blue, and cool white'],
  ['孔雀蓝、紫红与青铜色构成的浓郁色板', 'a rich palette of peacock blue, crimson, and bronze'],
]

const colorTreatments: BilingualPair[] = [
  ['色彩低饱和且对比柔和', 'with muted saturation and gentle contrast'],
  ['色彩明亮饱满但保持肤色自然', 'with vivid saturation while preserving natural skin tones'],
  ['采用双色调分离与清晰明暗关系', 'using a duotone separation with clear value structure'],
  ['采用单色层次与一种强调色', 'using monochromatic layers with one accent color'],
  ['高光略暖、阴影略冷', 'with slightly warm highlights and cool shadows'],
  ['采用胶片式褪色黑位与柔和高光滚降', 'with filmic faded blacks and soft highlight roll-off'],
]

const weatherConditions: BilingualPair[] = [
  ['细密春雨持续落下', 'steady fine spring rain'],
  ['大雪在无风环境中缓慢飘落', 'heavy snow falling slowly in still air'],
  ['雷暴云在远处翻涌', 'thunderclouds building in the distance'],
  ['清晨低雾贴近地面流动', 'low morning fog moving close to the ground'],
  ['晴朗天空中有少量高云', 'a clear sky with a few high clouds'],
  ['强风卷起落叶与衣摆', 'strong wind lifting fallen leaves and fabric'],
  ['雨后空气清澈，地面仍有积水', 'clear air after rain with puddles remaining'],
  ['轻柔海风带来潮湿水汽', 'a gentle sea breeze carrying humid mist'],
  ['干燥热浪使远景轻微扭曲', 'dry heat haze subtly distorting the distance'],
  ['冰冷霜雾覆盖清晨表面', 'cold frost mist coating morning surfaces'],
]

const weatherEffects: BilingualPair[] = [
  ['水滴在逆光中形成细小闪光', 'with droplets sparkling in backlight'],
  ['湿润表面产生真实环境倒影', 'with realistic environmental reflections on wet surfaces'],
  ['能见度逐渐降低并强化空间层次', 'with reduced visibility that strengthens spatial depth'],
  ['云层间隙透出局部光束', 'with localized light rays breaking through cloud gaps'],
  ['空气中的微粒随气流自然运动', 'with airborne particles moving naturally in the current'],
  ['天气效果与人物、服装和环境产生真实互动', 'with weather interacting realistically with people, clothing, and surroundings'],
]

const materialSurfaces: BilingualPair[] = [
  ['未经上釉的手工陶土表面', 'an unglazed handmade clay surface'],
  ['带细小划痕的拉丝金属表面', 'a brushed metal surface with fine scratches'],
  ['具有自然孔隙的浅色石材表面', 'a pale stone surface with natural pores'],
  ['纤维清晰可见的粗织亚麻表面', 'a coarse linen surface with visible fibers'],
  ['有细密开片纹的旧釉面', 'an aged glazed surface with fine crackle patterns'],
  ['半透明磨砂玻璃表面', 'a translucent frosted-glass surface'],
  ['带温润包浆的深色木质表面', 'a dark wood surface with a warm aged patina'],
  ['微微起皱的再生纸表面', 'a lightly wrinkled recycled-paper surface'],
  ['具有不规则颗粒的混凝土表面', 'a concrete surface with irregular aggregate'],
  ['带细腻绒毛方向的天鹅绒表面', 'a velvet surface with a visible directional nap'],
]

const surfaceDetails: BilingualPair[] = [
  ['呈现微距级别的真实细节', 'rendered with realistic macro-level detail'],
  ['边缘存在自然磨损与使用痕迹', 'with naturally worn edges and signs of use'],
  ['高光与粗糙度随表面结构准确变化', 'with highlights and roughness varying accurately across the surface'],
  ['细节清晰但不显得过度锐化', 'with crisp detail that does not look oversharpened'],
  ['保留手工制作产生的细微不规则', 'preserving subtle irregularities from handcrafting'],
  ['材料之间的接触、折叠与受力关系可信', 'with believable contact, folds, and tension between materials'],
]

export const EXPANDED_PROMPT_CATEGORIES: PromptCategory[] = [
  {
    id: 'subject',
    nameZh: '主体身份与成年信息',
    nameEn: 'Subject & Adult Identity',
    icon: 'i-carbon-user-avatar-filled',
    terms: crossTerms(
      'subject-x',
      adultProfiles,
      adultRoles,
      (profile, role) => `${profile}${role}`,
      (profile, role) => `${profile}, ${role}`,
    ),
  },
  {
    id: 'scene',
    nameZh: '场景与时段',
    nameEn: 'Scene & Time',
    icon: 'i-carbon-mountain',
    terms: crossTerms(
      'scene-x',
      scenePlaces,
      sceneTimes,
      (place, time) => `${time}，位于${place}`,
      (place, time) => `${place} ${time}`,
    ),
  },
  {
    id: 'action',
    nameZh: '动作与表情',
    nameEn: 'Action & Expression',
    icon: 'i-carbon-run',
    terms: crossTerms(
      'action-x',
      actions,
      expressions,
      (action, expression) => `${action}，${expression}`,
      (action, expression) => `${action}, ${expression}`,
    ),
  },
  {
    id: 'wardrobe',
    nameZh: '服饰与材质',
    nameEn: 'Wardrobe & Material',
    icon: 'i-carbon-shopping-bag',
    terms: crossTerms(
      'wardrobe-x',
      garments,
      garmentMaterials,
      (garment, material) => `${garment}，${material}`,
      (garment, material) => `${garment} ${material}`,
    ),
  },
  {
    id: 'camera',
    nameZh: '景别 / 镜头 / 焦距 / 光圈感',
    nameEn: 'Shot, Lens & Aperture',
    icon: 'i-carbon-camera',
    terms: crossTerms(
      'camera-x',
      shotAngles,
      lensTreatments,
      (shot, lens) => `${shot}，${lens}`,
      (shot, lens) => `${shot}, ${lens}`,
    ),
  },
  {
    id: 'lighting',
    nameZh: '光线与色调',
    nameEn: 'Lighting & Color Grade',
    icon: 'i-carbon-light',
    terms: crossTerms(
      'lighting-x',
      lightSetups,
      colorGrades,
      (light, grade) => `${light}，${grade}`,
      (light, grade) => `${light}, ${grade}`,
    ),
  },
  {
    id: 'composition',
    nameZh: '构图与主体位置',
    nameEn: 'Composition & Placement',
    icon: 'i-carbon-crop',
    terms: crossTerms(
      'composition-x',
      compositionStructures,
      subjectPlacements,
      (structure, placement) => `${structure}，${placement}`,
      (structure, placement) => `${structure}, ${placement}`,
    ),
  },
  {
    id: 'style',
    nameZh: '风格 / 媒介',
    nameEn: 'Style & Medium',
    icon: 'i-carbon-paint-brush',
    terms: crossTerms(
      'style-x',
      artisticMedia,
      styleDirections,
      (medium, direction) => `${medium}，${direction}`,
      (medium, direction) => `${medium} ${direction}`,
    ),
  },
  {
    id: 'constraints',
    nameZh: '细节约束与排斥项',
    nameEn: 'Detail & Negative Constraints',
    icon: 'i-carbon-checkmark-outline',
    terms: crossTerms(
      'constraints-x',
      qualityGoals,
      exclusions,
      (goal, exclusion) => `${goal}；${exclusion}`,
      (goal, exclusion) => `${goal}; ${exclusion}`,
    ),
  },
  {
    id: 'mood',
    nameZh: '情绪与氛围',
    nameEn: 'Mood & Atmosphere',
    icon: 'i-carbon-face-satisfied',
    terms: crossTerms(
      'mood-x',
      emotionalTones,
      atmosphereLayers,
      (mood, atmosphere) => `${mood}，${atmosphere}`,
      (mood, atmosphere) => `${mood}, ${atmosphere}`,
    ),
  },
  {
    id: 'palette',
    nameZh: '色彩方案',
    nameEn: 'Color Palette',
    icon: 'i-carbon-color-palette',
    terms: crossTerms(
      'palette-x',
      colorPalettes,
      colorTreatments,
      (palette, treatment) => `${palette}，${treatment}`,
      (palette, treatment) => `${palette}, ${treatment}`,
    ),
  },
  {
    id: 'weather',
    nameZh: '天气与空气效果',
    nameEn: 'Weather & Air Effects',
    icon: 'i-carbon-cloud',
    terms: crossTerms(
      'weather-x',
      weatherConditions,
      weatherEffects,
      (weather, effect) => `${weather}，${effect}`,
      (weather, effect) => `${weather}, ${effect}`,
    ),
  },
  {
    id: 'texture',
    nameZh: '材质与表面细节',
    nameEn: 'Texture & Surface Detail',
    icon: 'i-carbon-texture',
    terms: crossTerms(
      'texture-x',
      materialSurfaces,
      surfaceDetails,
      (surface, detail) => `${surface}，${detail}`,
      (surface, detail) => `${surface}, ${detail}`,
    ),
  },
]
