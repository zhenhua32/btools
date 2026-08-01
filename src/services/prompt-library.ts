import type { PromptCategory, PromptTerm } from './prompt-composer'

function blockTerms(prefix: string, source: string): PromptTerm[] {
  return source
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const separatorIndex = line.indexOf('|')
      const zh = (separatorIndex >= 0 ? line.slice(0, separatorIndex) : line).trim()
      const en = (separatorIndex >= 0 ? line.slice(separatorIndex + 1) : line).trim()
      return { id: `${prefix}-${index + 1}`, zh, en: en || zh }
    })
}

function numericTerms(
  prefix: string,
  values: readonly (string | number)[],
  zh: (value: string) => string,
  en: (value: string) => string,
): PromptTerm[] {
  return values.map((value, index) => ({
    id: `${prefix}-${index + 1}`,
    zh: zh(String(value)),
    en: en(String(value)),
  }))
}

function leaf(
  id: string,
  nameZh: string,
  nameEn: string,
  icon: string,
  terms: PromptTerm[],
): PromptCategory {
  return { id, nameZh, nameEn, icon, terms }
}

function branch(
  id: string,
  nameZh: string,
  nameEn: string,
  icon: string,
  children: PromptCategory[],
): PromptCategory {
  return { id, nameZh, nameEn, icon, terms: [], children }
}

const subjectChildren: PromptCategory[] = [
  leaf(
    'subject-age',
    '年龄',
    'Age',
    'i-carbon-calendar',
    numericTerms(
      'subject-age',
      Array.from({ length: 50 }, (_, index) => index + 18),
      (value) => `${value}岁`,
      (value) => `${value} years old`,
    ),
  ),
  leaf(
    'subject-gender',
    '性别呈现',
    'Gender Presentation',
    'i-carbon-gender-female',
    blockTerms(
      'subject-gender',
      `
女性|woman
男性|man
非二元性别者|non-binary person
中性气质|androgynous presentation
女性化呈现|feminine presentation
男性化呈现|masculine presentation
性别流动者|gender-fluid person
跨性别女性|transgender woman
跨性别男性|transgender man
不强调性别|gender-neutral presentation
`,
    ),
  ),
  leaf(
    'subject-industry',
    '行业领域',
    'Industry',
    'i-carbon-industry',
    blockTerms(
      'subject-industry',
      `
独立电影|independent film
商业电影|commercial cinema
纪实摄影|documentary photography
时尚行业|fashion industry
现代建筑|modern architecture
室内设计|interior design
平面设计|graphic design
产品设计|product design
数字艺术|digital art
当代艺术|contemporary art
古典音乐|classical music
爵士音乐|jazz music
电子音乐|electronic music
舞台表演|stage performance
科学研究|scientific research
航天工程|aerospace engineering
生态保护|ecological conservation
医疗健康|healthcare
餐饮行业|culinary industry
新闻媒体|news media
`,
    ),
  ),
  leaf(
    'subject-profession',
    '职业',
    'Profession',
    'i-carbon-portfolio',
    blockTerms(
      'subject-profession',
      `
导演|director
摄影师|photographer
电影摄影师|cinematographer
编剧|screenwriter
制片人|film producer
剪辑师|film editor
演员|actor
舞台导演|stage director
建筑师|architect
室内设计师|interior designer
景观设计师|landscape designer
城市规划师|urban planner
平面设计师|graphic designer
产品设计师|product designer
服装设计师|fashion designer
珠宝设计师|jewelry designer
插画师|illustrator
概念艺术家|concept artist
动画师|animator
雕塑家|sculptor
画家|painter
陶艺家|ceramic artist
版画家|printmaker
书法家|calligrapher
作曲家|composer
指挥家|conductor
钢琴家|pianist
小提琴家|violinist
吉他手|guitarist
鼓手|drummer
歌手|singer
舞者|dancer
编舞家|choreographer
作家|writer
诗人|poet
记者|journalist
编辑|editor
翻译|translator
教师|teacher
教授|professor
历史学家|historian
考古学家|archaeologist
哲学家|philosopher
心理学家|psychologist
医生|doctor
外科医生|surgeon
护士|nurse
药剂师|pharmacist
生物学家|biologist
植物学家|botanist
动物学家|zoologist
化学家|chemist
物理学家|physicist
天文学家|astronomer
地质学家|geologist
气象学家|meteorologist
工程师|engineer
软件工程师|software engineer
机器人专家|robotics specialist
宇航员|astronaut
飞行员|pilot
船长|ship captain
探险家|explorer
登山家|mountaineer
厨师|chef
面包师|baker
咖啡师|barista
农场主|farmer
园艺师|gardener
`,
    ),
  ),
  leaf(
    'subject-relationship',
    '人物关系',
    'Relationship',
    'i-carbon-group',
    blockTerms(
      'subject-relationship',
      `
独自一人|solo
情侣|couple
夫妻|married couple
兄妹|brother and sister
姐妹|sisters
兄弟|brothers
两位朋友|two friends
三人小组|group of three
工作伙伴|coworkers
创作搭档|creative partners
导师与学生|mentor and student
医生与患者|doctor and patient
摄影师与模特|photographer and model
乐队成员|band members
探险队成员|expedition members
`,
    ),
  ),
  leaf(
    'subject-appearance',
    '外貌特征',
    'Appearance',
    'i-carbon-face-cool',
    blockTerms(
      'subject-appearance',
      `
圆形脸|round face
椭圆脸|oval face
方形脸|square face
长形脸|long face
心形脸|heart-shaped face
高颧骨|high cheekbones
柔和下颌线|soft jawline
清晰下颌线|defined jawline
深色眼睛|dark eyes
浅色眼睛|light eyes
棕色眼睛|brown eyes
蓝色眼睛|blue eyes
绿色眼睛|green eyes
灰色眼睛|gray eyes
杏仁形眼睛|almond-shaped eyes
深眼窝|deep-set eyes
浓眉|thick eyebrows
细眉|thin eyebrows
雀斑|freckles
酒窝|dimples
自然皮肤纹理|natural skin texture
深色肤色|deep skin tone
浅色肤色|light skin tone
暖色肤色|warm skin tone
冷色肤色|cool skin tone
`,
    ),
  ),
  leaf(
    'subject-hair',
    '发型与毛发',
    'Hair & Grooming',
    'i-carbon-cut',
    blockTerms(
      'subject-hair',
      `
黑色短发|short black hair
棕色短发|short brown hair
银色短发|short silver hair
黑色长发|long black hair
棕色长发|long brown hair
金色长发|long blonde hair
红色长发|long red hair
自然卷发|naturally curly hair
紧密卷发|tight curls
波浪长发|long wavy hair
利落寸头|clean buzz cut
光头|shaved head
高马尾|high ponytail
低马尾|low ponytail
整齐发髻|neat bun
凌乱发髻|messy bun
齐刘海|straight bangs
侧分发型|side-parted hair
灰白头发|salt-and-pepper hair
修剪整齐的胡须|neatly trimmed beard
浓密胡须|full beard
八字胡|mustache
      `,
    ),
  ),
  leaf(
    'subject-beauty-aura',
    '女性气质',
    'Feminine Aesthetic',
    'i-carbon-sparkles',
    blockTerms(
      'subject-beauty-aura',
      `
美丽|beautiful
漂亮|pretty
优雅|elegant
端庄|graceful
明艳|radiant
清丽|delicately beautiful
清冷|cool and refined
甜美|sweet
温柔|gentle
知性|intellectual
成熟|mature
大方|poised
自信|confident
灵动|lively
妩媚|charming
性感|sensual
飒爽|dashing
英气|heroic
高贵|noble
典雅|classically elegant
精致|refined
自然|natural
清新|fresh
纯净|pure
神秘|mysterious
慵懒|effortlessly relaxed
浪漫|romantic
复古|vintage
时尚|fashionable
迷人|captivating
`,
    ),
  ),
  leaf(
    'subject-beauty-face',
    '女性面部细节',
    'Feminine Facial Detail',
    'i-carbon-face-wink',
    blockTerms(
      'subject-beauty-face',
      `
精致五官|delicate facial features
立体五官|sculpted facial features
柔和面部轮廓|soft facial contours
流畅下颌线|smooth jawline
小巧脸型|petite face
饱满额头|full forehead
自然眉形|natural eyebrows
柳叶眉|willow-shaped eyebrows
弯月眉|crescent-shaped eyebrows
英气剑眉|bold straight eyebrows
明亮双眸|bright eyes
清澈眼神|clear gaze
水润双眸|luminous eyes
深邃双眸|deep-set expressive eyes
含笑眼睛|smiling eyes
长睫毛|long eyelashes
卷翘睫毛|curled eyelashes
高挺鼻梁|high nose bridge
小巧鼻尖|delicate nose tip
自然鼻型|natural nose shape
饱满双唇|full lips
柔和唇形|soft lip shape
清晰唇峰|defined Cupid's bow
自然唇色|natural lip color
红润面颊|rosy cheeks
细腻肤质|fine skin texture
透亮肌肤|luminous skin
健康光泽|healthy glow
自然雀斑|natural freckles
浅浅酒窝|subtle dimples
`,
    ),
  ),
  leaf(
    'subject-beauty-makeup',
    '女性妆容',
    'Feminine Makeup',
    'i-carbon-color-palette',
    blockTerms(
      'subject-beauty-makeup',
      `
素颜感|bare-faced look
裸妆|nude makeup
淡妆|light makeup
自然妆容|natural makeup
清透底妆|sheer complexion makeup
水光底妆|dewy complexion makeup
哑光底妆|matte complexion makeup
柔雾妆效|soft-focus makeup
暖色妆容|warm-toned makeup
冷色妆容|cool-toned makeup
大地色眼妆|earth-tone eye makeup
玫瑰色眼妆|rose-toned eye makeup
烟熏眼妆|smoky eye makeup
细长眼线|fine elongated eyeliner
上扬眼线|winged eyeliner
自然睫毛|natural lashes
根根分明睫毛|defined separated lashes
豆沙唇色|muted rose lip color
裸粉唇色|nude pink lip color
珊瑚唇色|coral lip color
浆果唇色|berry lip color
正红唇色|classic red lip color
哑光唇妆|matte lips
水润唇妆|glossy lips
自然腮红|natural blush
蜜桃腮红|peach blush
玫瑰腮红|rose blush
轻微修容|subtle contouring
自然高光|natural highlighter
精致晚宴妆|refined evening makeup
`,
    ),
  ),
  leaf(
    'subject-beauty-posture',
    '女性体态',
    'Feminine Posture',
    'i-carbon-accessibility-alt',
    blockTerms(
      'subject-beauty-posture',
      `
高挑|tall
修长比例|elongated proportions
匀称身形|balanced figure
纤细身形|slender figure
健美身形|athletic figure
自然曲线|natural curves
挺拔体态|upright posture
优雅体态|graceful posture
从容姿态|composed posture
轻盈姿态|light posture
舒展肩颈|relaxed neck and shoulders
平直肩线|straight shoulder line
柔和肩线|soft shoulder line
修长手臂|long arms
纤细手指|slender fingers
修长双腿|long legs
自然站姿|natural standing pose
优雅坐姿|elegant seated pose
步态轻盈|light-footed gait
步态从容|composed gait
`,
    ),
  ),
]

const sceneChildren: PromptCategory[] = [
  leaf(
    'scene-interior',
    '室内空间',
    'Interior',
    'i-carbon-building',
    blockTerms(
      'scene-interior',
      `
极简工作室|minimalist studio
自然光摄影棚|daylight photo studio
工业风阁楼|industrial loft
现代客厅|modern living room
复古客厅|vintage living room
开放式厨房|open-plan kitchen
专业厨房|professional kitchen
古典图书馆|classical library
现代图书馆|modern library
大学实验室|university laboratory
艺术家工作室|artist studio
陶艺工坊|ceramic workshop
木工车间|woodworking shop
时装工作室|fashion atelier
后台化妆间|backstage dressing room
剧院舞台|theater stage
音乐录音棚|music recording studio
独立电影院|independent cinema
美术馆展厅|art gallery
历史博物馆|history museum
温室花房|glass greenhouse
精品咖啡馆|specialty coffee shop
复古餐厅|vintage restaurant
酒店大堂|hotel lobby
火车车厢|train carriage
`,
    ),
  ),
  leaf(
    'scene-urban',
    '城市空间',
    'Urban',
    'i-carbon-building-insights-1',
    blockTerms(
      'scene-urban',
      `
繁忙十字路口|busy intersection
霓虹夜市|neon night market
石板街巷|cobblestone alley
现代商业区|modern business district
玻璃幕墙天台|glass-tower rooftop
地铁站台|subway platform
地下通道|underground passage
火车站大厅|railway station concourse
城市公园|urban park
街角咖啡店|corner café
露天广场|public plaza
旧工业区|old industrial district
滨水步道|waterfront promenade
城市天桥|urban overpass
住宅阳台|apartment balcony
雨后街道|street after rain
清晨市场|early-morning market
历史街区|historic quarter
港口码头|harbor pier
高楼之间的窄巷|narrow alley between towers
`,
    ),
  ),
  leaf(
    'scene-nature',
    '自然环境',
    'Nature',
    'i-carbon-tree',
    blockTerms(
      'scene-nature',
      `
森林小径|forest trail
古老红杉林|ancient redwood forest
竹林|bamboo grove
热带雨林|tropical rainforest
白桦林|birch forest
高山草甸|alpine meadow
雪山山脊|snowy mountain ridge
冰川山谷|glacial valley
荒漠公路|desert highway
沙丘|sand dunes
盐湖|salt flat
黑色礁石海岸|black-rock coastline
白色沙滩|white-sand beach
悬崖海岸|coastal cliff
宁静湖畔|tranquil lakeside
芦苇湿地|reed wetland
蜿蜒河谷|winding river valley
壮阔瀑布|grand waterfall
岩石峡谷|rocky canyon
熔岩原野|lava field
花田|flower field
薰衣草田|lavender field
向日葵田|sunflower field
茶园|tea plantation
葡萄园|vineyard
果园|orchard
苔原|tundra
草原|grassland
云海|sea of clouds
洞穴|cave
`,
    ),
  ),
  leaf(
    'scene-time',
    '时段',
    'Time of Day',
    'i-carbon-time',
    blockTerms(
      'scene-time',
      `
黎明前|before dawn
黎明|dawn
日出时分|sunrise
清晨|early morning
上午|morning
正午|noon
午后|afternoon
傍晚|late afternoon
黄金时刻|golden hour
日落时分|sunset
暮色|dusk
蓝调时刻|blue hour
入夜|nightfall
夜晚|night
深夜|late night
午夜|midnight
春日|spring day
盛夏|midsummer
秋日|autumn day
冬日|winter day
`,
    ),
  ),
  leaf(
    'scene-era',
    '时代背景',
    'Era',
    'i-carbon-hourglass',
    blockTerms(
      'scene-era',
      `
史前时代|prehistoric era
古典时代|classical antiquity
中世纪|medieval era
文艺复兴时期|Renaissance era
巴洛克时期|Baroque era
维多利亚时代|Victorian era
工业革命时期|Industrial Revolution era
1920年代|1920s
1950年代|1950s
1960年代|1960s
1970年代|1970s
1980年代|1980s
1990年代|1990s
当代|contemporary era
遥远未来|distant future
`,
    ),
  ),
]

const actionChildren: PromptCategory[] = [
  leaf(
    'action-motion',
    '动作',
    'Action',
    'i-carbon-run',
    blockTerms(
      'action-motion',
      `
站立|standing
坐下|sitting
行走|walking
快步行走|striding
奔跑|running
冲刺|sprinting
跳跃|jumping
转身|turning around
回眸|looking back
旋转|spinning
舞蹈|dancing
伸展|stretching
俯身|leaning forward
后仰|leaning backward
蹲下|crouching
跪下|kneeling
攀爬|climbing
远足|hiking
骑自行车|cycling
驾驶|driving
划船|rowing
游泳|swimming
潜水|diving
冲浪|surfing
滑雪|skiing
滑冰|skating
阅读|reading
写作|writing
绘画|painting
素描|sketching
拍照|taking a photograph
演奏乐器|playing an instrument
烹饪|cooking
倒咖啡|pouring coffee
整理衣服|adjusting clothing
打开门|opening a door
推开窗户|opening a window
拾起物品|picking up an object
拥抱|hugging
挥手|waving
`,
    ),
  ),
  leaf(
    'action-hands',
    '手部动作',
    'Hand Gesture',
    'i-carbon-touch-1-filled',
    blockTerms(
      'action-hands',
      `
双手自然下垂|hands resting naturally at the sides
双手插袋|hands in pockets
双臂交叉|arms crossed
双手合拢|hands clasped
单手托腮|one hand supporting the chin
轻扶帽檐|touching the brim of a hat
整理袖口|adjusting a cuff
拨开头发|brushing hair aside
遮挡阳光|shielding the eyes from sunlight
握住杯子|holding a cup
捧着书本|holding a book
握住相机|holding a camera
指向远方|pointing into the distance
伸出手掌|extending an open palm
轻触墙面|touching a wall lightly
`,
    ),
  ),
  leaf(
    'action-pose',
    '姿态',
    'Pose',
    'i-carbon-accessibility',
    blockTerms(
      'action-pose',
      `
正面站姿|front-facing stance
侧面站姿|profile stance
三分之二侧身|three-quarter pose
背对镜头|back to the camera
重心落在单腿|weight on one leg
双脚平行站立|feet parallel
双腿交叉站立|legs crossed while standing
坐姿端正|upright seated pose
放松坐姿|relaxed seated pose
靠墙站立|leaning against a wall
倚靠栏杆|leaning on a railing
伏在桌前|leaning over a table
肩膀放松|relaxed shoulders
挺直背部|straight posture
动态失衡姿态|dynamic off-balance pose
`,
    ),
  ),
  leaf(
    'action-expression',
    '表情',
    'Expression',
    'i-carbon-face-satisfied',
    blockTerms(
      'action-expression',
      `
自然微笑|natural smile
克制微笑|restrained smile
开怀大笑|open laughter
平静表情|calm expression
专注表情|focused expression
坚定表情|determined expression
自信表情|confident expression
沉思表情|contemplative expression
惊讶表情|surprised expression
好奇表情|curious expression
放松表情|relaxed expression
严肃表情|serious expression
忧郁表情|melancholic expression
神秘表情|mysterious expression
警觉表情|alert expression
疲惫表情|tired expression
喜悦表情|joyful expression
悲伤表情|sad expression
愤怒表情|angry expression
中性表情|neutral expression
`,
    ),
  ),
  leaf(
    'action-gaze',
    '视线',
    'Gaze',
    'i-carbon-view',
    blockTerms(
      'action-gaze',
      `
直视镜头|looking directly at the camera
看向左侧|looking left
看向右侧|looking right
看向上方|looking upward
看向下方|looking downward
望向远方|gazing into the distance
闭上双眼|eyes closed
避开镜头|looking away from the camera
注视手中物品|looking at an object in hand
与另一人物对视|making eye contact with another person
`,
    ),
  ),
]

const wardrobeChildren: PromptCategory[] = [
  leaf(
    'wardrobe-garment',
    '服装单品',
    'Garment',
    'i-carbon-shopping-bag',
    blockTerms(
      'wardrobe-garment',
      `
白衬衫|white shirt
黑衬衫|black shirt
丝质衬衫|silk blouse
高领针织衫|turtleneck sweater
圆领毛衣|crew-neck sweater
针织开衫|knitted cardigan
基础T恤|basic T-shirt
背心|tank top
短款上衣|cropped top
结构化上衣|structured top
双排扣西装|double-breasted suit
单排扣西装|single-breasted suit
无领西装|collarless suit
长款风衣|long trench coat
羊毛大衣|wool overcoat
皮夹克|leather jacket
飞行夹克|bomber jacket
牛仔夹克|denim jacket
机能外套|technical jacket
连帽外套|hooded coat
直筒长裤|straight-leg trousers
阔腿长裤|wide-leg trousers
高腰长裤|high-waisted trousers
工装裤|cargo trousers
牛仔裤|denim jeans
短裤|shorts
铅笔裙|pencil skirt
百褶裙|pleated skirt
A字裙|A-line skirt
长裙|maxi skirt
衬衫裙|shirt dress
吊带长裙|slip dress
晚礼服|evening gown
结构化礼服|structured gown
连体裤|jumpsuit
工装连体服|utility coverall
实验室白袍|laboratory coat
围裙|apron
舞台服装|stage costume
极简长袍|minimalist robe
`,
    ),
  ),
  leaf(
    'wardrobe-material',
    '面料材质',
    'Fabric & Material',
    'i-carbon-texture',
    blockTerms(
      'wardrobe-material',
      `
纯棉|cotton
亚麻|linen
羊毛|wool
羊绒|cashmere
丝绸|silk
缎面|satin
天鹅绒|velvet
牛仔布|denim
天然皮革|natural leather
磨砂皮|suede
欧根纱|organza
薄纱|tulle
雪纺|chiffon
蕾丝|lace
粗花呢|tweed
灯芯绒|corduroy
帆布|canvas
针织面料|knitted fabric
绗缝面料|quilted fabric
防水面料|waterproof fabric
反光面料|reflective fabric
金属网布|metal mesh
珠饰面料|beaded fabric
刺绣面料|embroidered fabric
再生纤维|recycled fiber
`,
    ),
  ),
  leaf(
    'wardrobe-accessory',
    '配饰',
    'Accessory',
    'i-carbon-catalog',
    blockTerms(
      'wardrobe-accessory',
      `
宽檐帽|wide-brim hat
贝雷帽|beret
针织帽|knitted beanie
棒球帽|baseball cap
丝巾|silk scarf
粗织围巾|chunky scarf
领带|necktie
领结|bow tie
皮带|leather belt
背带|suspenders
圆框眼镜|round glasses
方框眼镜|square glasses
太阳镜|sunglasses
腕表|wristwatch
细链项链|fine chain necklace
珍珠项链|pearl necklace
耳环|earrings
胸针|brooch
手套|gloves
皮革手提包|leather handbag
`,
    ),
  ),
  leaf(
    'wardrobe-footwear',
    '鞋履',
    'Footwear',
    'i-carbon-pedestrian',
    blockTerms(
      'wardrobe-footwear',
      `
白色运动鞋|white sneakers
复古运动鞋|retro sneakers
黑色皮鞋|black leather shoes
牛津鞋|Oxford shoes
乐福鞋|loafers
高跟鞋|high heels
低跟鞋|low heels
踝靴|ankle boots
长筒靴|knee-high boots
登山靴|hiking boots
工装靴|work boots
切尔西靴|Chelsea boots
凉鞋|sandals
芭蕾平底鞋|ballet flats
赤脚|barefoot
      `,
    ),
  ),
  leaf(
    'wardrobe-female-tops',
    '女士上装',
    'Women’s Tops',
    'i-carbon-shirt',
    blockTerms(
      'wardrobe-female-tops',
      `
泡泡袖衬衫|puff-sleeve blouse
荷叶边衬衫|ruffled blouse
蝴蝶结衬衫|bow-neck blouse
系带衬衫|tie-front blouse
裹身上衣|wrap top
一字肩上衣|off-shoulder top
露肩上衣|cold-shoulder top
方领上衣|square-neck top
心形领上衣|sweetheart-neck top
挂脖上衣|halter top
无袖真丝上衣|sleeveless silk top
蕾丝上衣|lace top
薄纱上衣|sheer chiffon top
刺绣上衣|embroidered top
胸衣式上衣|corset-style top
短款针织衫|cropped knit top
修身针织衫|fitted knit top
短款针织开衫|cropped cardigan
珍珠纽扣开衫|pearl-button cardigan
法式针织开衫|French-style cardigan
罗纹背心|ribbed tank top
真丝吊带上衣|silk camisole
缎面吊带上衣|satin camisole
收腰马甲|fitted waistcoat
西装马甲|tailored suit vest
荷叶边短上衣|ruffled crop top
灯笼袖上衣|lantern-sleeve top
喇叭袖上衣|bell-sleeve top
瑜伽上衣|yoga top
运动背心|athletic tank top
`,
    ),
  ),
  leaf(
    'wardrobe-female-dresses',
    '女士裙装',
    'Women’s Dresses',
    'i-carbon-fashion',
    blockTerms(
      'wardrobe-female-dresses',
      `
小黑裙|little black dress
裹身裙|wrap dress
茶歇裙|tea dress
衬衫裙|shirt dress
针织连衣裙|knitted dress
吊带裙|slip dress
背心裙|pinafore dress
抹胸裙|strapless dress
挂脖裙|halter-neck dress
一字肩连衣裙|off-shoulder dress
方领连衣裙|square-neck dress
泡泡袖连衣裙|puff-sleeve dress
灯笼袖连衣裙|lantern-sleeve dress
收腰连衣裙|cinched-waist dress
高腰连衣裙|empire-waist dress
A字连衣裙|A-line dress
直筒连衣裙|shift dress
修身连衣裙|body-skimming dress
铅笔连衣裙|pencil dress
伞摆连衣裙|fit-and-flare dress
不对称连衣裙|asymmetrical dress
高低摆连衣裙|high-low dress
开衩连衣裙|slit dress
百褶连衣裙|pleated dress
荷叶边连衣裙|ruffled dress
蕾丝连衣裙|lace dress
雪纺连衣裙|chiffon dress
丝绸连衣裙|silk dress
缎面连衣裙|satin dress
天鹅绒连衣裙|velvet dress
印花连衣裙|printed dress
波点连衣裙|polka-dot dress
碎花连衣裙|floral dress
牛仔连衣裙|denim dress
亚麻连衣裙|linen dress
`,
    ),
  ),
  leaf(
    'wardrobe-female-bottoms',
    '女士下装',
    'Women’s Bottoms',
    'i-carbon-row',
    blockTerms(
      'wardrobe-female-bottoms',
      `
高腰直筒裤|high-waisted straight trousers
高腰阔腿裤|high-waisted wide-leg trousers
高腰锥形裤|high-waisted tapered trousers
西装长裤|tailored trousers
九分裤|cropped trousers
喇叭裤|flared trousers
纸袋腰长裤|paperbag-waist trousers
真丝长裤|silk trousers
针织长裤|knitted trousers
皮革长裤|leather trousers
高腰牛仔裤|high-waisted jeans
直筒牛仔裤|straight-leg jeans
阔腿牛仔裤|wide-leg jeans
牛仔短裤|denim shorts
西装短裤|tailored shorts
高腰短裤|high-waisted shorts
迷你裙|mini skirt
中长裙|midi skirt
及踝长裙|ankle-length skirt
鱼尾裙|mermaid skirt
伞裙|circle skirt
裹身裙|wrap skirt
开衩长裙|slit maxi skirt
不对称半身裙|asymmetrical skirt
缎面半身裙|satin skirt
`,
    ),
  ),
  leaf(
    'wardrobe-female-outerwear',
    '女士外套',
    'Women’s Outerwear',
    'i-carbon-umbrella',
    blockTerms(
      'wardrobe-female-outerwear',
      `
收腰西装|fitted blazer
廓形西装|oversized blazer
短款西装|cropped blazer
双排扣女式西装|women’s double-breasted blazer
无领粗花呢外套|collarless tweed jacket
短款粗花呢外套|cropped tweed jacket
短款皮夹克|cropped leather jacket
麂皮短外套|suede jacket
修身牛仔夹克|fitted denim jacket
短款飞行夹克|cropped bomber jacket
束腰风衣|belted trench coat
短款风衣|short trench coat
长款羊毛大衣|long wool coat
浴袍式大衣|robe coat
茧型大衣|cocoon coat
斗篷大衣|cape coat
披肩外套|shawl coat
人造皮草外套|faux-fur coat
羽绒服|down jacket
绗缝外套|quilted jacket
针织披肩|knitted wrap
羊绒披肩|cashmere wrap
长款针织开衫|long cardigan
短款针织外套|cropped knit jacket
机车夹克|biker jacket
`,
    ),
  ),
  leaf(
    'wardrobe-female-formal',
    '女士礼服',
    'Women’s Formalwear',
    'i-carbon-star-filled',
    blockTerms(
      'wardrobe-female-formal',
      `
鸡尾酒礼服|cocktail dress
及地晚礼服|floor-length evening gown
鱼尾晚礼服|mermaid evening gown
A字晚礼服|A-line evening gown
舞会礼服|ball gown
帝国腰线礼服|empire-waist gown
露肩礼服|off-shoulder gown
抹胸礼服|strapless gown
单肩礼服|one-shoulder gown
挂脖礼服|halter-neck gown
深V领礼服|plunging V-neck gown
高领礼服|high-neck gown
长袖礼服|long-sleeve gown
披风式礼服|cape gown
开衩礼服|slit gown
露背礼服|open-back gown
蕾丝礼服|lace gown
薄纱礼服|tulle gown
丝绸礼服|silk gown
缎面礼服|satin gown
天鹅绒礼服|velvet gown
亮片礼服|sequined gown
珠饰礼服|beaded gown
刺绣礼服|embroidered gown
结构感礼服|architectural gown
`,
    ),
  ),
  leaf(
    'wardrobe-neckline',
    '领型',
    'Neckline',
    'i-carbon-crop-growth',
    blockTerms(
      'wardrobe-neckline',
      `
圆领|crew neckline
高圆领|high crew neckline
V领|V neckline
深V领|plunging V neckline
方领|square neckline
一字领|boat neckline
露肩领|off-shoulder neckline
心形领|sweetheart neckline
抹胸领|strapless neckline
挂脖领|halter neckline
高领|high neckline
堆堆领|cowl neckline
彼得潘领|Peter Pan collar
娃娃领|doll collar
衬衫领|shirt collar
立领|stand collar
海军领|sailor collar
西装领|notched lapel
青果领|shawl collar
荷叶边领|ruffled collar
系带领|tie neckline
不对称领|asymmetrical neckline
单肩领|one-shoulder neckline
钥匙孔领|keyhole neckline
水滴领|teardrop neckline
`,
    ),
  ),
  leaf(
    'wardrobe-sleeve',
    '袖型',
    'Sleeve',
    'i-carbon-fit-to-screen',
    blockTerms(
      'wardrobe-sleeve',
      `
无袖|sleeveless
短袖|short sleeves
五分袖|elbow-length sleeves
七分袖|three-quarter sleeves
长袖|long sleeves
贴身长袖|fitted long sleeves
宽松长袖|relaxed long sleeves
泡泡袖|puff sleeves
灯笼袖|lantern sleeves
羊腿袖|leg-of-mutton sleeves
喇叭袖|bell sleeves
花瓣袖|petal sleeves
飞飞袖|flutter sleeves
蝙蝠袖|batwing sleeves
插肩袖|raglan sleeves
落肩袖|drop-shoulder sleeves
荷叶边袖|ruffled sleeves
开衩袖|slit sleeves
透明薄纱袖|sheer tulle sleeves
蕾丝长袖|long lace sleeves
`,
    ),
  ),
  leaf(
    'wardrobe-female-detail',
    '女士服装细节',
    'Women’s Garment Detail',
    'i-carbon-settings-adjust',
    blockTerms(
      'wardrobe-female-detail',
      `
高腰线|high waistline
低腰线|low waistline
帝国腰线|empire waistline
收腰剪裁|cinched-waist tailoring
宽松剪裁|relaxed tailoring
修身剪裁|fitted tailoring
不对称剪裁|asymmetrical cut
露背设计|open-back design
镂空设计|cutout design
侧开衩|side slit
前开衩|front slit
高开衩|high slit
层叠裙摆|layered hem
荷叶边装饰|ruffle detailing
褶皱设计|ruched detailing
抽褶设计|gathered detailing
立体打褶|structured pleating
束带设计|belted design
系带设计|tie detailing
蝴蝶结装饰|bow detailing
珍珠纽扣|pearl buttons
包布纽扣|fabric-covered buttons
金属纽扣|metal buttons
精细刺绣|fine embroidery
珠饰细节|beaded detailing
亮片装饰|sequin detailing
蕾丝拼接|lace panels
薄纱拼接|tulle panels
撞色滚边|contrast piping
手工缝线|hand-finished stitching
`,
    ),
  ),
]

const cameraChildren: PromptCategory[] = [
  leaf(
    'camera-shot',
    '景别',
    'Shot Size',
    'i-carbon-camera',
    blockTerms(
      'camera-shot',
      `
极端特写|extreme close-up
面部特写|facial close-up
细节特写|detail close-up
头肩近景|head-and-shoulders shot
胸部以上近景|bust shot
腰部以上中景|waist-up medium shot
膝部以上中远景|medium-long shot
七分身人像|three-quarter body shot
全身人像|full-body shot
双人镜头|two-shot
群像镜头|group shot
环境人像|environmental portrait
远景|long shot
大远景|extreme long shot
建立镜头|establishing shot
`,
    ),
  ),
  leaf(
    'camera-angle',
    '机位与视角',
    'Angle & Viewpoint',
    'i-carbon-cube-view',
    blockTerms(
      'camera-angle',
      `
平视|eye-level view
低机位|low-angle view
极低机位|ground-level view
高机位|high-angle view
鸟瞰|bird's-eye view
垂直俯拍|top-down view
航拍|aerial view
虫视|worm's-eye view
侧面视角|side view
正面视角|front view
背面视角|rear view
三分之二视角|three-quarter view
肩后视角|over-the-shoulder view
主观视角|first-person view
荷兰角|Dutch angle
门框视角|view through a doorway
窗外视角|view through a window
镜面反射视角|mirror-reflection view
水面反射视角|water-reflection view
贴近地面视角|floor-level perspective
`,
    ),
  ),
  leaf(
    'camera-focal-length',
    '焦距',
    'Focal Length',
    'i-carbon-lens',
    numericTerms(
      'camera-focal-length',
      [8, 10, 12, 14, 16, 18, 20, 24, 28, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 100, 105, 135, 200],
      (value) => `${value}mm焦距`,
      (value) => `${value}mm focal length`,
    ),
  ),
  leaf(
    'camera-aperture',
    '光圈',
    'Aperture',
    'i-carbon-circle-measurement',
    numericTerms(
      'camera-aperture',
      ['1.0', '1.2', '1.4', '1.8', '2.0', '2.8', '3.2', '4', '5.6', '6.3', '8', '11', '16', '22', '32'],
      (value) => `f/${value}光圈`,
      (value) => `f/${value} aperture`,
    ),
  ),
  leaf(
    'camera-movement',
    '镜头运动与效果',
    'Camera Movement & Effect',
    'i-carbon-movement',
    blockTerms(
      'camera-movement',
      `
固定镜头|locked-off camera
手持镜头|handheld camera
稳定器镜头|gimbal-stabilized shot
缓慢推镜|slow push-in
快速推镜|fast push-in
缓慢拉镜|slow pull-out
横向摇镜|horizontal pan
纵向摇镜|vertical tilt
环绕镜头|orbiting shot
跟随镜头|tracking shot
平行跟拍|parallel tracking shot
升降镜头|crane shot
滑轨镜头|dolly shot
变焦镜头|zoom shot
希区柯克变焦|dolly zoom
甩镜|whip pan
长曝光|long exposure
运动模糊|motion blur
冻结动作|frozen action
浅景深|shallow depth of field
深景深|deep depth of field
柔焦|soft focus
散景|bokeh
移轴效果|tilt-shift effect
鱼眼畸变|fisheye distortion
`,
    ),
  ),
]

const lightingChildren: PromptCategory[] = [
  leaf(
    'lighting-source',
    '光源',
    'Light Source',
    'i-carbon-light',
    blockTerms(
      'lighting-source',
      `
自然窗光|natural window light
直射阳光|direct sunlight
漫射天光|diffused skylight
阴天自然光|overcast natural light
月光|moonlight
烛光|candlelight
壁炉光|fireplace light
霓虹灯|neon light
荧光灯|fluorescent light
钨丝灯|tungsten light
LED灯|LED light
路灯|streetlight
车灯|car headlights
舞台聚光灯|stage spotlight
投影仪光|projector light
柔光箱|softbox light
美人碟|beauty dish
环形灯|ring light
反光板补光|reflector fill
体积光|volumetric light
`,
    ),
  ),
  leaf(
    'lighting-pattern',
    '布光方式',
    'Lighting Pattern',
    'i-carbon-brightness-contrast',
    blockTerms(
      'lighting-pattern',
      `
正面光|front lighting
侧面光|side lighting
逆光|backlighting
轮廓光|rim lighting
顶光|top lighting
底光|underlighting
蝴蝶光|butterfly lighting
伦勃朗光|Rembrandt lighting
分割光|split lighting
环形布光|loop lighting
宽面光|broad lighting
窄面光|short lighting
高调布光|high-key lighting
低调布光|low-key lighting
硬光|hard light
柔光|soft light
条纹光影|striped light and shadow
斑驳树影|dappled foliage light
剪影光|silhouette lighting
边缘高光|edge highlight
`,
    ),
  ),
  leaf(
    'lighting-temperature',
    '色温',
    'Color Temperature',
    'i-carbon-temperature-hot',
    numericTerms(
      'lighting-temperature',
      Array.from({ length: 20 }, (_, index) => 2000 + index * 300),
      (value) => `${value}K色温`,
      (value) => `${value}K color temperature`,
    ),
  ),
]

const compositionChildren: PromptCategory[] = [
  leaf(
    'composition-structure',
    '构图结构',
    'Composition Structure',
    'i-carbon-crop',
    blockTerms(
      'composition-structure',
      `
三分法|rule of thirds
居中构图|centered composition
对称构图|symmetrical composition
不对称构图|asymmetrical composition
黄金分割|golden ratio
黄金螺旋|golden spiral
对角线构图|diagonal composition
三角形构图|triangular composition
S形构图|S-curve composition
L形构图|L-shaped composition
圆形构图|circular composition
放射状构图|radial composition
框中框|frame within a frame
引导线|leading lines
消失点构图|vanishing-point composition
负空间构图|negative-space composition
填满画面|fill-the-frame composition
重复图案|repeating pattern
视觉平衡|visual balance
层次构图|layered composition
前景遮挡|foreground occlusion
隧道构图|tunnel composition
平铺构图|flat-lay composition
拼贴构图|collage composition
开放式构图|open composition
`,
    ),
  ),
  leaf(
    'composition-placement',
    '主体位置',
    'Subject Placement',
    'i-carbon-center-circle',
    blockTerms(
      'composition-placement',
      `
主体居中|subject centered
主体偏左|subject placed left
主体偏右|subject placed right
主体靠上|subject placed high
主体靠下|subject placed low
主体位于左上|subject in the upper left
主体位于右上|subject in the upper right
主体位于左下|subject in the lower left
主体位于右下|subject in the lower right
主体占满前景|subject filling the foreground
主体位于中景|subject in the middle ground
主体位于远景|subject in the background
主体比例较小|small subject scale
主体比例较大|large subject scale
主体部分出框|subject partially out of frame
`,
    ),
  ),
]

const styleChildren: PromptCategory[] = [
  leaf(
    'style-medium',
    '媒介',
    'Medium',
    'i-carbon-paint-brush',
    blockTerms(
      'style-medium',
      `
写实摄影|photorealistic photography
纪实摄影|documentary photography
街头摄影|street photography
时尚摄影|fashion photography
人像摄影|portrait photography
建筑摄影|architectural photography
产品摄影|product photography
静物摄影|still-life photography
微距摄影|macro photography
航拍摄影|aerial photography
胶片摄影|film photography
黑白摄影|black-and-white photography
油画|oil painting
丙烯画|acrylic painting
水彩画|watercolor painting
水粉画|gouache painting
粉彩画|pastel painting
蛋彩画|tempera painting
水墨画|ink-wash painting
铅笔素描|pencil drawing
炭笔素描|charcoal drawing
钢笔画|pen-and-ink drawing
彩色铅笔画|colored-pencil drawing
木刻版画|woodblock print
丝网印刷|screen print
铜版蚀刻|copperplate etching
剪纸|paper cut art
拼贴画|collage
陶瓷雕塑|ceramic sculpture
黏土动画|clay animation
像素艺术|pixel art
矢量插画|vector illustration
三维渲染|3D rendering
低多边形艺术|low-poly art
信息图表|infographic
`,
    ),
  ),
  leaf(
    'style-aesthetic',
    '审美风格',
    'Aesthetic',
    'i-carbon-watson-health-3d-mpr-toggle',
    blockTerms(
      'style-aesthetic',
      `
极简主义|minimalism
现代主义|modernism
后现代主义|postmodernism
超现实主义|surrealism
表现主义|expressionism
印象主义|impressionism
未来主义|futurism
构成主义|constructivism
装饰艺术|Art Deco
新艺术运动|Art Nouveau
包豪斯风格|Bauhaus style
波普艺术|pop art
欧普艺术|Op Art
粗野主义|brutalism
浪漫主义|Romanticism
古典主义|classicism
巴洛克风格|Baroque style
洛可可风格|Rococo style
复古未来主义|retrofuturism
赛博朋克|cyberpunk
太阳朋克|solarpunk
蒸汽朋克|steampunk
梦核|dreamcore
暗黑学院风|dark academia
乡村质朴风|rustic aesthetic
`,
    ),
  ),
]

const constraintChildren: PromptCategory[] = [
  leaf(
    'constraints-quality',
    '细节要求',
    'Detail Requirement',
    'i-carbon-checkmark-outline',
    blockTerms(
      'constraints-quality',
      `
自然皮肤纹理|natural skin texture
准确人体比例|accurate body proportions
自然肢体姿态|natural limb posture
正确手部结构|anatomically correct hands
正确手指数目|correct finger count
对称瞳孔|symmetrical pupils
清晰眼神|clear eyes
一致面部特征|consistent facial features
真实布料纹理|realistic fabric texture
准确服装接缝|accurate garment seams
一致光源方向|consistent light direction
真实投影关系|realistic cast shadows
真实环境反射|realistic environmental reflections
准确透视|accurate perspective
笔直建筑线条|straight architectural lines
干净主体边缘|clean subject edges
自然发丝细节|natural flyaway hair
平滑色彩渐变|smooth color gradients
清晰微小细节|crisp fine detail
真实材质粗糙度|realistic material roughness
`,
    ),
  ),
  leaf(
    'constraints-negative',
    '排斥项',
    'Negative Prompt',
    'i-carbon-subtract-alt',
    blockTerms(
      'constraints-negative',
      `
无额外手指|no extra fingers
无缺失手指|no missing fingers
无重复肢体|no duplicated limbs
无融合肢体|no fused limbs
无扭曲手部|no distorted hands
无扭曲面部|no distorted face
无不对称眼睛|no asymmetrical eyes
无交叉眼|no crossed eyes
无模糊五官|no blurred facial features
无蜡像皮肤|no waxy skin
无塑料质感|no plastic texture
无过度磨皮|no excessive skin smoothing
无重影|no ghosting
无随机人物|no random people
无杂乱背景|no cluttered background
无文字|no text
无乱码|no gibberish
无水印|no watermark
无品牌标识|no brand logo
无界面元素|no interface elements
无边框|no border
无压缩噪点|no compression artifacts
无色带断层|no color banding
无过度锐化|no oversharpening
无过度曝光|no overexposure
无死黑阴影|no crushed shadows
无错误反射|no incorrect reflections
无弯曲直线|no bent straight lines
无透视错误|no perspective errors
无裁切头顶|no cropped head
`,
    ),
  ),
]

const moodChildren: PromptCategory[] = [
  leaf(
    'mood-emotion',
    '情绪',
    'Emotion',
    'i-carbon-favorite',
    blockTerms(
      'mood-emotion',
      `
平静|calm
宁静|serene
温暖|warm
亲密|intimate
浪漫|romantic
怀旧|nostalgic
喜悦|joyful
俏皮|playful
乐观|optimistic
充满希望|hopeful
自由|free-spirited
冒险|adventurous
自信|confident
坚定|determined
庄严|solemn
宏大|epic
神秘|mysterious
梦幻|dreamlike
忧郁|melancholic
孤独|lonely
疏离|detached
紧张|tense
不安|uneasy
急迫|urgent
沉思|contemplative
`,
    ),
  ),
  leaf(
    'mood-atmosphere',
    '环境氛围',
    'Atmosphere',
    'i-carbon-fog',
    blockTerms(
      'mood-atmosphere',
      `
电影感|cinematic atmosphere
纪实感|documentary atmosphere
静谧感|hushed atmosphere
庆典感|festive atmosphere
仪式感|ceremonial atmosphere
压迫感|oppressive atmosphere
空灵感|ethereal atmosphere
超现实感|surreal atmosphere
复古感|vintage atmosphere
未来感|futuristic atmosphere
手工感|handcrafted atmosphere
生活化|everyday atmosphere
戏剧性|dramatic atmosphere
诗意|poetic atmosphere
沉浸感|immersive atmosphere
`,
    ),
  ),
]

const paletteChildren: PromptCategory[] = [
  leaf(
    'palette-color',
    '颜色',
    'Color',
    'i-carbon-color-palette',
    blockTerms(
      'palette-color',
      `
象牙白|ivory
纯白|pure white
炭黑|charcoal black
暖灰|warm gray
冷灰|cool gray
沙色|sand
米色|beige
焦糖棕|caramel brown
赭石|ochre
陶土红|terracotta
珊瑚橙|coral orange
琥珀色|amber
柠檬黄|lemon yellow
芥末黄|mustard yellow
橄榄绿|olive green
森林绿|forest green
薄荷绿|mint green
青色|cyan
孔雀蓝|peacock blue
天空蓝|sky blue
海军蓝|navy blue
群青|ultramarine
靛蓝|indigo
薰衣草紫|lavender
电光紫|electric violet
洋红|magenta
樱花粉|blossom pink
酒红|burgundy
玫瑰金|rose gold
银色|silver
`,
    ),
  ),
  leaf(
    'palette-treatment',
    '色彩处理',
    'Color Treatment',
    'i-carbon-color-switch',
    blockTerms(
      'palette-treatment',
      `
单色|monochromatic
双色调|duotone
三色配色|triadic color scheme
互补色|complementary colors
邻近色|analogous colors
分裂互补色|split-complementary colors
中性色|neutral palette
大地色|earth-tone palette
粉彩色|pastel palette
珠宝色|jewel-tone palette
霓虹色|neon palette
低饱和|desaturated colors
高饱和|highly saturated colors
高对比|high color contrast
低对比|low color contrast
暖色调|warm color grade
冷色调|cool color grade
青橙调色|teal-and-orange grade
褪色胶片调色|faded film grade
自然白平衡|natural white balance
`,
    ),
  ),
]

const weatherChildren: PromptCategory[] = [
  leaf(
    'weather-condition',
    '天气',
    'Weather',
    'i-carbon-cloud',
    blockTerms(
      'weather-condition',
      `
晴天|clear weather
多云|partly cloudy
阴天|overcast weather
薄雾|light mist
浓雾|dense fog
细雨|drizzle
阵雨|rain shower
大雨|heavy rain
暴雨|rainstorm
雷暴|thunderstorm
小雪|light snow
大雪|heavy snow
暴风雪|blizzard
冰雹|hail
霜冻|frost
干燥|dry weather
潮湿|humid weather
热浪|heat wave
寒潮|cold snap
微风|gentle breeze
强风|strong wind
大风|gale
沙尘|blowing dust
沙尘暴|sandstorm
雨后|after rain
`,
    ),
  ),
  leaf(
    'weather-effect',
    '空气效果',
    'Atmospheric Effect',
    'i-carbon-windy',
    blockTerms(
      'weather-effect',
      `
空气透视|aerial perspective
地面薄雾|ground fog
山间云雾|mountain mist
水面蒸汽|steam above water
漂浮尘埃|floating dust
空气微粒|airborne particles
雨滴|raindrops
飞雪|drifting snow
飘落树叶|falling leaves
风吹发丝|windblown hair
风吹衣摆|windblown fabric
湿润地面|wet ground
水面倒影|water reflection
热浪扭曲|heat shimmer
光束穿雾|light rays through mist
`,
    ),
  ),
]

const textureChildren: PromptCategory[] = [
  leaf(
    'texture-material',
    '材质',
    'Material',
    'i-carbon-texture',
    blockTerms(
      'texture-material',
      `
拉丝金属|brushed metal
抛光金属|polished metal
氧化铜|oxidized copper
黄铜|brass
铬金属|chrome
磨砂玻璃|frosted glass
透明玻璃|clear glass
彩色玻璃|stained glass
大理石|marble
花岗岩|granite
石灰岩|limestone
混凝土|concrete
红砖|red brick
陶土|terracotta clay
釉面陶瓷|glazed ceramic
原木|raw wood
深色胡桃木|dark walnut
软木|cork
再生纸|recycled paper
手工纸|handmade paper
天然橡胶|natural rubber
树脂|resin
珍珠母|mother of pearl
贝壳|seashell
冰晶|ice crystal
`,
    ),
  ),
  leaf(
    'texture-finish',
    '表面质感',
    'Surface Finish',
    'i-carbon-gradient',
    blockTerms(
      'texture-finish',
      `
哑光表面|matte surface
高光表面|glossy surface
半光表面|satin surface
粗糙表面|rough surface
光滑表面|smooth surface
多孔表面|porous surface
颗粒表面|granular surface
磨损表面|worn surface
做旧表面|aged surface
开裂表面|cracked surface
起皱表面|wrinkled surface
编织纹理|woven texture
压花纹理|embossed texture
手工痕迹|handmade marks
自然包浆|natural patina
`,
    ),
  ),
]

export const ATOMIC_PROMPT_CATEGORIES: PromptCategory[] = [
  branch(
    'subject',
    '主体身份',
    'Subject Identity',
    'i-carbon-user-avatar-filled',
    subjectChildren,
  ),
  branch(
    'scene',
    '场景与时段',
    'Scene & Time',
    'i-carbon-mountain',
    sceneChildren,
  ),
  branch(
    'action',
    '动作与表情',
    'Action & Expression',
    'i-carbon-run',
    actionChildren,
  ),
  branch(
    'wardrobe',
    '服饰与材质',
    'Wardrobe & Fabric',
    'i-carbon-shopping-bag',
    wardrobeChildren,
  ),
  branch(
    'camera',
    '镜头与摄影',
    'Camera & Photography',
    'i-carbon-camera',
    cameraChildren,
  ),
  branch(
    'lighting',
    '光线与色温',
    'Lighting & Temperature',
    'i-carbon-light',
    lightingChildren,
  ),
  branch(
    'composition',
    '构图与位置',
    'Composition & Placement',
    'i-carbon-crop',
    compositionChildren,
  ),
  branch(
    'style',
    '风格与媒介',
    'Style & Medium',
    'i-carbon-paint-brush',
    styleChildren,
  ),
  branch(
    'constraints',
    '细节约束',
    'Detail Constraints',
    'i-carbon-checkmark-outline',
    constraintChildren,
  ),
  branch(
    'mood',
    '情绪与氛围',
    'Mood & Atmosphere',
    'i-carbon-face-satisfied',
    moodChildren,
  ),
  branch(
    'palette',
    '色彩方案',
    'Color Palette',
    'i-carbon-color-palette',
    paletteChildren,
  ),
  branch(
    'weather',
    '天气与空气效果',
    'Weather & Air Effects',
    'i-carbon-cloud',
    weatherChildren,
  ),
  branch(
    'texture',
    '材质与表面',
    'Material & Surface',
    'i-carbon-texture',
    textureChildren,
  ),
]
