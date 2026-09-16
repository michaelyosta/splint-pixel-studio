import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, 'content/catalog-manifest.json');
const registryPath = resolve(root, 'content/content-registry.json');

const negativeConstraints = [
  'no monochrome black-and-white output', 'no grayscale-only output', 'no muddy beige-on-beige palette', 'no random rainbow palette', 'no photographic textures',
  'no text', 'no letters', 'no watermark', 'no signature', 'no logo', 'no trademark',
  'no copyrighted characters', 'no franchise references', 'no named artist imitation',
  'no cropped focal objects', 'no extra limbs', 'no malformed hands or paws',
  'no pseudo-text', 'no filled black background', 'no hatching', 'no cross-hatching',
  'no sketch lines', 'no texture strokes', 'no wood grain', 'no fur strokes',
  'no dense micro-details', 'no tiny fragmented regions', 'no open boundaries',
  'no nearly-touching boundaries', 'no narrow slivers',
];

const difficultyByIndex = ['simple', 'simple', 'simple', 'medium', 'medium', 'medium', 'medium', 'detailed', 'detailed', 'detailed'];
const orientationPatterns = [
  ...Array.from({ length: 24 }, () => ['portrait', 'portrait', 'square', 'portrait', 'landscape', 'portrait', 'portrait', 'square', 'portrait', 'portrait']),
  ...Array.from({ length: 2 }, () => ['portrait', 'square', 'portrait', 'landscape', 'square', 'portrait', 'portrait', 'square', 'portrait', 'portrait']),
  ...Array.from({ length: 4 }, () => ['portrait', 'square', 'portrait', 'square', 'portrait', 'portrait', 'portrait', 'square', 'portrait', 'portrait']),
  ...Array.from({ length: 2 }, () => ['portrait', 'portrait', 'square', 'landscape', 'portrait', 'landscape', 'portrait', 'square', 'portrait', 'portrait']),
];

const dimensions = {
  portrait: { width: 1600, height: 2000, grid_width: 64, grid_height: 80 },
  square: { width: 1600, height: 1600, grid_width: 64, grid_height: 64 },
  landscape: { width: 2000, height: 1500, grid_width: 80, grid_height: 60 },
};

const common = {
  audience: ['teens', 'adults'],
  season: ['evergreen'],
};

const collections = [
  { id: 'col_autumn-cozy', slug: 'autumn-cozy', title: 'Осенний уют', access: 'free', theme: 'cozy', mood: 'cozy', season: ['autumn'], albums: [
    { id: 'alb_autumn-cozy-coffee-rain', slug: 'coffee-rain', title: 'Кофе и дождь', scenes: [
      ['Тихое окно с чашкой', 'A steaming mug rests on a small window ledge while rain traces the glass and a folded blanket waits nearby.', ['window', 'coffee', 'rain']],
      ['Блокнот у дождливого окна', 'An open blank journal, pencil, and round teacup form a calm still life beside a rain-speckled window.', ['journaling', 'tea', 'window']],
      ['Котёнок и плед на подоконнике', 'A small original kitten curls on a blanket beside a mug, with raindrops and potted leaves framing the window.', ['kitten', 'blanket', 'rain']],
      ['Кофейная тележка под навесом', 'A tiny neighborhood coffee cart sits beneath a striped awning as puddles reflect umbrellas and hanging plants.', ['cart', 'awning', 'puddles']],
      ['Осенний стол для письма', 'A wooden writing table holds envelopes, a ceramic coffee pot, acorns, and a warm lamp near a tall rainy pane.', ['desk', 'letters', 'acorns']],
      ['Дождевой сад за стеклом', 'A glass conservatory filled with ferns, a small café table, and a rain barrel creates a layered rainy garden scene.', ['conservatory', 'ferns', 'garden']],
      ['Сапоги у крыльца', 'Rain boots, a woven basket, a folded umbrella, and a steaming travel cup gather on a cottage porch with leaf-strewn steps.', ['boots', 'porch', 'umbrella']],
      ['Ночной кофе в оранжерее', 'A glasshouse café at night shows hanging vines, a barista counter, patterned chairs, and rain-lit panes.', ['night', 'greenhouse', 'café']],
      ['Трамвайная остановка с термосом', 'A quiet tram shelter frames a seated traveler, a thermos, wet rails, and a row of autumn trees beyond.', ['tram', 'shelter', 'traveler']],
      ['Чернильная карта дождливого города', 'A desk scene combines a blank map, compass, coffee cup, fountain pen, and a miniature rainy city model.', ['map', 'compass', 'city']],
    ]},
    { id: 'alb_autumn-cozy-warm-evenings', slug: 'warm-evenings', title: 'Тёплые вечера', scenes: [
      ['Фонарики на балконе', 'A small balcony with string lanterns, cushions, a tea tray, and potted herbs opens toward a calm evening sky.', ['balcony', 'lanterns', 'tea']],
      ['Плед и каштаны у камина', 'A low hearth, knitted blanket, chestnuts, and a basket of firewood make a welcoming autumn corner.', ['fireplace', 'chestnuts', 'blanket']],
      ['Тыквенная полка без праздника', 'A shelf displays ordinary pumpkins, a ceramic vase, dried leaves, and stacked bowls in a warm home interior.', ['pumpkins', 'shelf', 'vase']],
      ['Вечерняя мастерская свечей', 'A workbench holds unlabelled candles, wax tools, dried flowers, and a small window with falling leaves.', ['candles', 'workbench', 'flowers']],
      ['Домик на холме в сумерках', 'A little hilltop house, winding path, chimney, vegetable patch, and distant hills form a peaceful dusk landscape.', ['house', 'hill', 'path']],
      ['Книжный угол с горячим какао', 'A reading chair, low bookcase, cocoa mug, slippers, and a cat-shaped cushion create a layered evening nook.', ['reading', 'cocoa', 'chair']],
      ['Сбор яблок после заката', 'A ladder, orchard basket, windfall apples, and a lantern sit beneath broad branches after sunset.', ['orchard', 'apples', 'lantern']],
      ['Музыка в мансарде', 'An attic room contains a small upright piano, music stand with blank pages, roof window, plants, and knitted cushions.', ['attic', 'piano', 'plants']],
      ['Велосипед у светлой лавки', 'A vintage bicycle leans by a tiny evening market stall with baskets, pumpkins, bunting shapes, and a street lamp.', ['bicycle', 'market', 'streetlamp']],
      ['Пикник под медной луной', 'A moonlit hillside picnic uses a patterned cloth, thermos, pears, lantern, and layered autumn grasses.', ['picnic', 'moon', 'hillside']],
    ]},
  ]},
  { id: 'col_forest-friends', slug: 'forest-friends', title: 'Лесные друзья', access: 'free', theme: 'forest', mood: 'calm', season: ['evergreen', 'autumn'], albums: [
    { id: 'alb_forest-friends_fox-hedgehog-hare', slug: 'fox-hedgehog-hare', title: 'Лисы, ежи и зайцы', scenes: [
      ['Лиса с корзинкой ягод', 'An original fox walks through ferns carrying a berry basket, with mushrooms and a winding woodland path.', ['fox', 'berries', 'ferns']],
      ['Ёжик у чайного пня', 'A gentle hedgehog sits beside a tree-stump tea table with acorns, leaves, and a tiny kettle.', ['hedgehog', 'stump', 'tea']],
      ['Заяц среди папоротников', 'A long-eared rabbit pauses in a fern clearing framed by stones, seed pods, and a fallen branch.', ['hare', 'ferns', 'clearing']],
      ['Лесной почтальон-лис', 'An original fox in a simple satchel follows trail markers past pinecones, a bridge, and mossy roots.', ['fox', 'satchel', 'bridge']],
      ['Ежевичный привал', 'A hedgehog rests at a woodland picnic blanket with blackberries, a cup, pinecones, and layered shrubs.', ['hedgehog', 'blackberries', 'picnic']],
      ['Заяц и карта тропинок', 'A rabbit studies a blank trail map beside a stump, compass, lantern, and three branching forest paths.', ['rabbit', 'map', 'paths']],
      ['Лисий дом под корнями', 'A cozy root hollow has a round door, stacked logs, mushroom caps, leaf garlands, and a fox peeking outside.', ['fox', 'root-house', 'mushrooms']],
      ['Три друга у водопада', 'A fox, hedgehog, and rabbit share a quiet waterfall overlook with ferns, stepping stones, and a wooden sign shape without text.', ['friends', 'waterfall', 'stones']],
      ['Заячья лодка на лесном пруду', 'A rabbit rows a tiny wooden boat across a pond with lily pads, reeds, dragonflies, and a beaver lodge in the distance.', ['rabbit', 'boat', 'pond']],
      ['Лисёнок в грибном круге', 'A young original fox stands inside a ring of varied mushrooms beneath twisted branches and hanging seed pods.', ['fox', 'mushrooms', 'seed-pods']],
    ]},
    { id: 'alb_forest-friends_mushroom-homes', slug: 'mushroom-homes', title: 'Домики под грибами', scenes: [
      ['Домик под большим грибом', 'A tiny round woodland home sits beneath a broad mushroom cap with a stone path and fern curtains.', ['mushroom', 'home', 'path']],
      ['Почтовый ящик у мха', 'A mossy mushroom cottage has a small mailbox, acorn steps, hanging herbs, and a snail on the path.', ['cottage', 'mailbox', 'snail']],
      ['Мостик между грибными домиками', 'Two little mushroom-roof homes connect by a curved bridge over a stream with reeds and stepping stones.', ['homes', 'bridge', 'stream']],
      ['Лесная пекарня под шляпкой', 'A mushroom bakery kiosk shows an open oven, bread baskets, herb bundles, and a winding root-lined trail.', ['bakery', 'oven', 'herbs']],
      ['Домик хранителя семян', 'A seed keeper cabin beneath a spotted cap contains jars, a wheelbarrow, climbing vines, and a bird feeder.', ['cabin', 'seeds', 'bird-feeder']],
      ['Грибная библиотека', 'A round woodland library uses shelves, ladders, blank book spines, a reading cushion, and a lantern beneath a giant cap.', ['library', 'books', 'lantern']],
      ['Дождь на грибной улице', 'A tiny forest lane of mushroom homes has umbrellas, puddles, leaf gutters, flower boxes, and winding roots.', ['lane', 'umbrellas', 'puddles']],
      ['Праздник светящихся шляпок', 'Original woodland creatures gather around a ring of lantern-like mushrooms, bunting shapes, baskets, and a low stage.', ['festival', 'creatures', 'mushrooms']],
      ['Мастерская деревянных ключей', 'A carpenter mushroom home shows a workbench, carved keys, tool rack, timber stacks, and a little owl perch.', ['workshop', 'keys', 'owl']],
      ['Тайный двор под корнями', 'A hidden courtyard beneath roots includes three mushroom cottages, a fountain, a herb garden, and winding stairs.', ['courtyard', 'fountain', 'garden']],
    ]},
  ]},
  { id: 'col_sweet-cafe', slug: 'sweet-cafe', title: 'Sweet Café', access: 'free', theme: 'cozy', mood: 'cozy', season: ['evergreen'], albums: [
    { id: 'alb_sweet-cafe_bakes-coffee', slug: 'bakes-coffee', title: 'Выпечка и кофе', scenes: [
      ['Круассан на утренней стойке', 'A bakery counter presents a croissant, coffee pot, linen cloth, and little vase beneath a striped awning.', ['croissant', 'coffee', 'bakery']],
      ['Булочка с корицей и открытка', 'A cinnamon bun, coffee cup, blank postcard, and spoon sit on a café table beside a sunny window.', ['bun', 'postcard', 'window']],
      ['Мини-пекарня в фургончике', 'A tiny bakery van displays trays, a coffee hatch, potted flowers, and a bicycle parked beside it.', ['van', 'bakery', 'bicycle']],
      ['Кафе на книжной полке', 'A whimsical miniature café fits between oversized blank books with a counter, stools, pastries, and a hanging lamp.', ['miniature', 'books', 'café']],
      ['Завтрак на круглой террасе', 'A round terrace table holds toast, jam, coffee, a vase, and folded napkins with a city roofline beyond.', ['breakfast', 'terrace', 'rooftops']],
      ['Бариста и витрина пирогов', 'An original barista stands behind a glassless pastry case with pies, cups, plants, and a chalkboard shape left blank.', ['barista', 'pies', 'counter']],
      ['Серванты с чашками', 'A café pantry shelf is filled with varied cups, a moka pot, stacked plates, pastries, and hanging herbs.', ['cups', 'pantry', 'moka-pot']],
      ['Кофейная лодка на канале', 'A small floating coffee bar glides along a canal with a serving hatch, bicycles, bridges, and hanging plants.', ['boat', 'canal', 'coffee']],
      ['Пекарня в старом трамвае', 'An original bakery occupies a vintage tram interior with rows of buns, a coffee station, windows, and overhead handles.', ['tram', 'bakery', 'interior']],
      ['Полдник в зимнем саду', 'A glass-roof café garden shows a long table with pastries, coffee service, vines, benches, and layered plants.', ['conservatory', 'pastries', 'vines']],
    ]},
    { id: 'alb_sweet-cafe_cute-desserts', slug: 'cute-desserts', title: 'Милые десерты', scenes: [
      ['Торт с ягодным венком', 'A round cake with a berry wreath sits on a pedestal among forks, leaves, and a tiny gift box without text.', ['cake', 'berries', 'pedestal']],
      ['Мороженое в лодочке', 'A whimsical ice-cream sundae in a small bowl is surrounded by spoons, fruit slices, napkins, and flowers.', ['ice-cream', 'fruit', 'flowers']],
      ['Печенье-звёздочки', 'Star-shaped cookies, a rolling pin, flour bowl, cooling rack, and scattered crumbs make a friendly baking scene.', ['cookies', 'rolling-pin', 'baking']],
      ['Пирожные на витрине', 'A dessert display holds varied pastries on tiers with ribbons, a serving tong, and a café window behind.', ['pastries', 'display', 'café']],
      ['Желейный сад', 'A tiny dessert garden uses jelly domes, fruit leaves, a spoon bridge, and sugar-like crystal shapes.', ['jelly', 'garden', 'fruit']],
      ['Чайная башня макарунов', 'A tiered dessert stand carries macarons, teacups, flowers, and a lace cloth on a small round table.', ['macarons', 'tea', 'stand']],
      ['Пончики на колёсах', 'A cheerful dessert cart with donut shapes, paper trays, a bicycle wheel, and a flower box sits in a plaza.', ['donuts', 'cart', 'plaza']],
      ['Леденцовая оранжерея', 'A whimsical greenhouse displays candy-like botanical forms, dessert trays, winding benches, and hanging pots.', ['greenhouse', 'candy', 'plants']],
      ['Медовый замок', 'A fantasy dessert castle has honeycomb towers, biscuit gates, berry flags without symbols, and a moat of tea.', ['castle', 'honeycomb', 'tea']],
      ['Ночной столик с десертом', 'A moonlit dessert table presents a layered parfait, spoon, folded napkin, vase, and patterned window.', ['parfait', 'moonlight', 'table']],
    ]},
  ]},
  { id: 'col_cozy-home', slug: 'cozy-home', title: 'Мой уютный дом', access: 'free', theme: 'cozy', mood: 'cozy', season: ['evergreen'], albums: [
    { id: 'alb_cozy-home_dream-rooms', slug: 'dream-rooms', title: 'Комнаты мечты', scenes: [
      ['Солнечная кухня с травами', 'A welcoming kitchen has open shelves, herb pots, a round table, a kettle, and a wide window.', ['kitchen', 'herbs', 'window']],
      ['Гостиная с круглым ковром', 'A living room centers on a round rug, low sofa, plant stand, books, and a floor lamp.', ['living-room', 'rug', 'sofa']],
      ['Мансардная спальня', 'A roof room contains a bed, skylight, trunk, hanging plants, and a little reading chair.', ['bedroom', 'skylight', 'plants']],
      ['Мастерская у большого окна', 'A craft room shows a worktable, thread spools, scissors, baskets, pegboard, and a bright window.', ['craft-room', 'spools', 'window']],
      ['Зимний сад внутри дома', 'A home conservatory has a bench, botanical shelves, watering can, patterned floor, and layered glass panes.', ['conservatory', 'bench', 'watering-can']],
      ['Лестница с галереей рам', 'A curved staircase passes blank frames, plants, a runner, baskets, and a small landing table.', ['staircase', 'frames', 'plants']],
      ['Домашняя кухня для друзей', 'A long dining kitchen has place settings, a bread basket, hanging pans, a window seat, and open cupboards.', ['dining', 'kitchen', 'table']],
      ['Музыкальная гостиная', 'A music room contains a piano, record shelf without labels, armchair, plants, and a tall arched window.', ['music-room', 'piano', 'window']],
      ['Домик на колёсах', 'An original tiny home interior combines a loft bed, kitchenette, plants, storage shelves, and a round porthole.', ['tiny-home', 'loft', 'kitchen']],
      ['Уютная комната под стеклянной крышей', 'A glass-roof room layers a daybed, books, plants, a small fireplace, and a star-shaped skylight.', ['glass-roof', 'daybed', 'fireplace']],
    ]},
    { id: 'alb_cozy-home_reading-nooks', slug: 'reading-nooks', title: 'Reading Nooks', scenes: [
      ['Кресло у книжной стены', 'A deep armchair sits beside a full book wall with blank spines, a side table, mug, and plant.', ['reading', 'books', 'chair']],
      ['Чтение на подоконнике', 'A wide window seat holds cushions, an open blank book, slippers, and a hanging vine.', ['window-seat', 'book', 'vine']],
      ['Палатка для чтения', 'A fabric reading tent uses pillows, a lantern, stacked books without text, and a small rug.', ['tent', 'lantern', 'books']],
      ['Библиотечный балкон', 'A mezzanine library balcony has a ladder, rail, tall shelves, reading chair, and trailing plants.', ['balcony', 'library', 'ladder']],
      ['Книжный угол под лестницей', 'The space beneath a staircase becomes a small nook with bench, drawers, lamp, and layered books.', ['under-stairs', 'bench', 'lamp']],
      ['Садовая библиотека', 'A glass garden library combines a desk, blank books, fern beds, wicker chair, and open French doors.', ['garden-library', 'desk', 'ferns']],
      ['Кресло в ночном свете', 'A reading chair, low lamp, moonlit window, cat cushion, and small table create a quiet night corner.', ['night', 'chair', 'lamp']],
      ['Плавучая библиотека', 'A tiny boat library has curved shelves, a reading bench, blank book spines, oars, and a calm river.', ['boat', 'library', 'river']],
      ['Читальный зал в башне', 'A round tower reading room contains a spiral ladder, arched windows, desk, books, and hanging lanterns.', ['tower', 'reading-room', 'ladder']],
      ['Поезд-библиотека', 'A cozy rail carriage library has facing benches, overhead shelves, blank books, lamps, and a view of hills.', ['train', 'library', 'hills']],
    ]},
  ]},
  { id: 'col_flower-day', slug: 'flower-day', title: 'Цветочный день', access: 'free', theme: 'botanical', mood: 'calm', season: ['spring', 'summer'], albums: [
    { id: 'alb_flower-day_wildflowers', slug: 'wildflowers', title: 'Полевые цветы', scenes: [
      ['Венок из луговых трав', 'A circular wreath of distinct wildflowers, grasses, seed heads, and small butterflies fills the page.', ['wreath', 'wildflowers', 'butterflies']],
      ['Ваза с ромашками', 'A simple ceramic vase of daisies stands on a cloth with loose petals, leaves, and a sunny window.', ['daisies', 'vase', 'window']],
      ['Луговая тропинка', 'A winding meadow path passes tall flowers, a bench, stones, and distant rounded hills.', ['meadow', 'path', 'bench']],
      ['Шмель над клевером', 'An original bumblebee hovers over clover blooms with leaves, seed pods, and a low meadow horizon.', ['bumblebee', 'clover', 'meadow']],
      ['Полевой букет в кувшине', 'A rustic pitcher holds varied stems beside gardening shears, ribbon, and a woven basket.', ['bouquet', 'pitcher', 'basket']],
      ['Домик среди цветов', 'A small cottage is surrounded by wildflower beds, stepping stones, a bicycle, and a simple fence.', ['cottage', 'flowers', 'bicycle']],
      ['Сбор семян на лугу', 'A gardener gathers seed heads with envelopes, basket, gloves, and layered wildflowers around the figure.', ['gardener', 'seeds', 'wildflowers']],
      ['Мостик через цветочный ручей', 'A curved footbridge crosses a stream surrounded by layered banks of wildflowers, reeds, and stones.', ['bridge', 'stream', 'flowers']],
      ['Фея-почтальон среди трав', 'An original tiny winged courier carries a blank envelope through tall grasses with flowers and a lantern.', ['fairy', 'envelope', 'grasses']],
      ['Ночной луг с закрывающимися цветами', 'A moonlit meadow shows varied flowers, a resting fox, tall grass, distant trees, and a small lantern.', ['night', 'meadow', 'fox']],
    ]},
    { id: 'alb_flower-day_gardens-bouquets', slug: 'gardens-bouquets', title: 'Сады и букеты', scenes: [
      ['Розовый сад у стены', 'A garden wall supports climbing roses, a bench, stone path, watering can, and a small gate.', ['rose-garden', 'wall', 'bench']],
      ['Букет в мастерской флориста', 'A florist table holds pruning shears, ribbon, vase, loose stems, and shelves of unlabeled pots.', ['florist', 'bouquet', 'worktable']],
      ['Теплица с горшками', 'A small greenhouse is packed with orderly plant benches, pots, watering tools, and roof panes.', ['greenhouse', 'pots', 'tools']],
      ['Садовая арка', 'A flower-covered arch opens to a path with a bench, birdbath, stepping stones, and layered borders.', ['arch', 'path', 'birdbath']],
      ['Букет полевых пионов', 'A broad bouquet of peony-like original blooms fills a ceramic jug beside scissors and folded paper.', ['peonies', 'jug', 'paper']],
      ['Садовый чайный стол', 'A round tea table sits inside a formal garden with teapot, cups, parasol, clipped hedges, and flowers.', ['tea', 'garden', 'parasol']],
      ['Оранжерея с водяными лилиями', 'A botanical conservatory displays a shallow lily pond, paths, hanging pots, and arched windows.', ['lilies', 'pond', 'conservatory']],
      ['Лунный сад трав', 'A night herb garden uses raised beds, a moon-shaped trellis, lanterns, stone paths, and a small shed.', ['moon-garden', 'herbs', 'trellis']],
      ['Парад садовых скульптур', 'Original abstract garden sculptures stand among flowers, clipped shrubs, gravel paths, and a fountain.', ['sculptures', 'garden', 'fountain']],
      ['Цветочный рынок на площади', 'A flower market square has multiple stalls, buckets, bicycles, awnings, and a central fountain.', ['market', 'flowers', 'square']],
    ]},
  ]},
  { id: 'col_easy-calm', slug: 'easy-calm', title: 'Easy Calm', access: 'free', theme: 'geometric', mood: 'calm', season: ['evergreen'], albums: [
    { id: 'alb_easy-calm_simple-mandalas', slug: 'simple-mandalas', title: 'Простые мандалы', scenes: [
      ['Мандала из листьев', 'A balanced radial mandala built from large leaves, simple petals, seed pods, and open rings.', ['mandala', 'leaves', 'radial']],
      ['Мандала солнечных дуг', 'A simple radial pattern combines broad sun arcs, circles, rays, and generous open sections.', ['mandala', 'sun', 'geometry']],
      ['Мандала морских раковин', 'A calm radial arrangement uses large shells, waves, dots, and spiral forms with clear enclosed spaces.', ['mandala', 'shells', 'waves']],
      ['Мандала из домиков', 'A circular pattern of tiny houses, windows, roofs, and trees uses repeated but varied large shapes.', ['mandala', 'homes', 'trees']],
      ['Мандала ягод и трав', 'A radial botanical design combines berries, stems, simple flowers, and rounded leaves.', ['mandala', 'berries', 'botanical']],
      ['Мандала воздушных шаров', 'A playful radial pattern uses balloons, strings, clouds, and wide circular bands.', ['mandala', 'balloons', 'clouds']],
      ['Мандала камней и волн', 'A zen-inspired radial pattern has smooth stones, water arcs, reeds, and broad concentric rings.', ['mandala', 'stones', 'water']],
      ['Мандала ночного сада', 'A detailed radial garden uses moons, flowers, moths, leaves, and nested ornamental borders.', ['mandala', 'moon', 'moths']],
      ['Мандала маленьких путешествий', 'A complex radial pattern combines a compass, train, bicycle, mountains, and winding paths.', ['mandala', 'travel', 'compass']],
      ['Мандала уютных предметов', 'A rich radial arrangement includes mugs, blankets, lamps, books, plants, and layered circular frames.', ['mandala', 'cozy', 'objects']],
    ]},
    { id: 'alb_easy-calm_bold-easy-patterns', slug: 'bold-easy-patterns', title: 'Bold & Easy Patterns', scenes: [
      ['Крупные волны', 'A bold repeating pattern of large waves, bubbles, shells, and rounded open bands.', ['pattern', 'waves', 'bold']],
      ['Солнечная клетка', 'A simple geometric repeat combines suns, squares, dots, and curved borders with large regions.', ['pattern', 'sun', 'grid']],
      ['Листья в ритме', 'A calm repeating botanical pattern alternates large leaves, stems, buds, and empty breathing bands.', ['pattern', 'leaves', 'rhythm']],
      ['Городские арки', 'A bold pattern of arches, windows, doors, and street lamps creates an abstract city rhythm.', ['pattern', 'city', 'arches']],
      ['Крупные цветы', 'An easy floral repeat uses oversized petals, leaves, circles, and simple background bands.', ['pattern', 'flowers', 'bold']],
      ['Мягкие горы', 'A repeating landscape pattern combines rounded mountains, clouds, suns, and winding paths.', ['pattern', 'mountains', 'clouds']],
      ['Чайные формы', 'A playful pattern of teacups, teapots, spoons, and leaves uses closed bold shapes.', ['pattern', 'tea', 'objects']],
      ['Детальный садовый орнамент', 'A layered ornamental repeat combines trellises, roses, gates, vines, and varied framed cells.', ['pattern', 'garden', 'ornament']],
      ['Ночной городской ритм', 'A detailed repeat uses moon shapes, rooftops, windows, bridges, stars, and layered streets.', ['pattern', 'night-city', 'rooftops']],
      ['Фантазийная мозаика', 'A dense but colorable pattern combines original shells, leaves, tiny houses, moons, and geometric frames.', ['pattern', 'mosaic', 'fantasy']],
    ]},
  ]},
  { id: 'col_tiny-adventures', slug: 'tiny-adventures', title: 'Tiny Adventures', access: 'free', theme: 'travel', mood: 'focus', season: ['evergreen'], albums: [
    { id: 'alb_tiny-adventures_forest-hike', slug: 'forest-hike', title: 'Поход в лес', scenes: [
      ['Рюкзак у тропы', 'A compact hiking pack, boots, map, flask, and trail stones wait beside the start of a forest path.', ['hiking', 'pack', 'path']],
      ['Перекус на пне', 'A hiker takes a break at a log with a thermos, fruit, blanket, and woodland plants nearby.', ['hiker', 'snack', 'log']],
      ['Мост через ручей', 'A small footbridge crosses a forest stream with a backpack, stepping stones, reeds, and pines.', ['bridge', 'stream', 'pines']],
      ['Палатка среди сосен', 'A simple tent stands in a pine clearing with sleeping roll, lantern, boots, and a cooking pot.', ['tent', 'camp', 'pines']],
      ['Наблюдение за птицами', 'A birdwatcher with binoculars stands beneath branches beside a field notebook and wooden blind.', ['birdwatching', 'binoculars', 'notebook']],
      ['Лесной компас', 'A close scene shows a hand holding a compass over a map, roots, mushrooms, and a branching trail.', ['compass', 'map', 'trail']],
      ['Пикник на смотровой площадке', 'A forest overlook has a blanket, basket, binoculars, distant layered hills, and a sign shape without text.', ['overlook', 'picnic', 'hills']],
      ['Ночной лагерь светлячков', 'A detailed camp scene includes tent, fire ring without flames, lanterns, trees, fireflies, and a winding path.', ['camp', 'fireflies', 'night']],
      ['Канатная тропа в кронах', 'An original treetop walkway crosses giant branches with ropes, platforms, distant birds, and forest layers.', ['treetop', 'walkway', 'ropes']],
      ['Секретная пещера за водопадом', 'A detailed hiking adventure reveals a cave behind a waterfall with gear, crystals, roots, and stepping stones.', ['cave', 'waterfall', 'crystals']],
    ]},
    { id: 'alb_tiny-adventures_little-town', slug: 'little-town', title: 'Маленький город', scenes: [
      ['Пекарня на углу', 'A small-town corner bakery has an awning, bicycle, window display, flower boxes, and cobbled street.', ['town', 'bakery', 'bicycle']],
      ['Трамвайный круг', 'A compact town square has a tram loop, bench, fountain, trees, and simple shopfronts without text.', ['tram', 'square', 'fountain']],
      ['Мостик у канала', 'A quiet canal bridge features bicycles, a boat, waterside steps, flower pots, and narrow homes.', ['canal', 'bridge', 'bicycles']],
      ['Рынок выходного дня', 'A weekend market fills a small plaza with stalls, baskets, umbrellas, produce, and a clock tower without lettering.', ['market', 'plaza', 'clock']],
      ['Почтовая тележка', 'A little delivery cart travels past row houses, a mailbox, trees, and a low stone wall.', ['cart', 'houses', 'mailbox']],
      ['Мастерская у переулка', 'A craft workshop opens onto a lane with tools, bicycle, potted plants, and hanging fabric shapes.', ['workshop', 'lane', 'tools']],
      ['Городская крыша-сад', 'A rooftop garden has raised beds, watering cans, a bench, laundry lines, and a view over varied roofs.', ['rooftop', 'garden', 'city']],
      ['Вечерняя площадь фонарей', 'A detailed town square uses lantern poles, café tables, market stalls, trees, paving patterns, and distant rooftops.', ['town', 'lanterns', 'square']],
      ['Миниатюрный вокзал', 'A detailed little station includes a platform, train, luggage, clock, flower beds, and a footbridge.', ['station', 'train', 'platform']],
      ['Городской фестиваль бумажных фонариков', 'A detailed original town festival fills a street with paper lantern shapes, stalls, bicycles, rooftops, and trees.', ['festival', 'lanterns', 'street']],
    ]},
  ]},
  { id: 'col_pen-pals', slug: 'pen-pals', title: 'Pen Pals', access: 'free', theme: 'journaling', mood: 'calm', season: ['evergreen'], albums: [
    { id: 'alb_pen-pals_letters-postcards', slug: 'letters-postcards', title: 'Письма и открытки', scenes: [
      ['Письменный стол с конвертами', 'A desk holds blank envelopes, a fountain pen, stamp shapes without marks, dried flowers, and a small lamp.', ['letters', 'desk', 'flowers']],
      ['Открытка с видом на море', 'A blank postcard, seashell, pencil, cup, and window frame suggest a seaside correspondence table.', ['postcard', 'sea', 'shell']],
      ['Почтовый ящик в саду', 'A garden mailbox stands among flowers, letters, a bicycle basket, and a winding path.', ['mailbox', 'garden', 'bicycle']],
      ['Письмо в поезде', 'A train table shows blank stationery, envelope, mug, ticket shape without text, and passing landscape.', ['train', 'letter', 'landscape']],
      ['Стопка открыток с горами', 'A stack of blank mountain postcards sits with a compass, wool hat, pinecone, and travel mug.', ['postcards', 'mountains', 'compass']],
      ['Письмо из оранжереи', 'A greenhouse writing table holds blank paper, pressed leaves, scissors, twine, and potted plants.', ['greenhouse', 'letter', 'pressed-leaves']],
      ['Почтальон на велосипеде', 'An original bicycle courier carries a satchel past hedges, a bridge, mailboxes, and flower baskets.', ['courier', 'bicycle', 'mail']],
      ['Карта дружеских маршрутов', 'A detailed desk scene combines blank postcards, folded maps, compass, ticket shapes, and travel keepsakes.', ['maps', 'postcards', 'travel']],
      ['Ночной обмен письмами', 'A detailed moonlit balcony shows two separate mailboxes, string lanterns, envelopes, plants, and a quiet street below.', ['night', 'mailboxes', 'balcony']],
      ['Почтовый кораблик', 'A detailed fantasy mail boat carries blank envelopes through a river town with bridges, docks, and signal flags without symbols.', ['boat', 'mail', 'river-town']],
    ]},
    { id: 'alb_pen-pals_journals-stationery', slug: 'journals-stationery', title: 'Дневники и канцелярия', scenes: [
      ['Открытый дневник и карандаши', 'An open blank journal lies beside pencils, clips, a ruler, leaves, and a tidy pen cup.', ['journal', 'pencils', 'desk']],
      ['Наклейки без букв', 'A stationery tray contains decorative sticker shapes without text, scissors, washi-like bands, and a notebook.', ['stationery', 'stickers', 'notebook']],
      ['Папка с рисунками', 'A folder of blank art sheets, graphite tools, binder clips, and a small plant fills a work table.', ['folder', 'art-tools', 'plant']],
      ['Календарь без дат', 'A blank monthly calendar grid, mug, markers, clips, and a leafy desk plant create a planning scene.', ['calendar', 'markers', 'plant']],
      ['Письменный угол путешественника', 'A travel journal, passport-shaped blank booklet, compass, postcards, and camera rest on a desk.', ['travel', 'journal', 'camera']],
      ['Коробка с лентами', 'A craft drawer opens to reveal ribbons, paper rolls, scissors, envelopes, and a tiny bouquet.', ['ribbons', 'craft', 'envelopes']],
      ['Книжная закладка мастерской', 'A handmade bookmark workspace uses pressed flowers, thread, hole punch, blank cards, and a desk lamp.', ['bookmark', 'flowers', 'thread']],
      ['Большой стол скрапбукинга', 'A detailed scrapbooking table layers blank pages, patterned shapes, tools, baskets, ribbons, and botanical elements.', ['scrapbook', 'table', 'botanical']],
      ['Архив писем в шкафу', 'A detailed stationery room contains labeled-free boxes, shelves, rolling ladder, envelopes, plants, and a reading stool.', ['archive', 'letters', 'shelves']],
      ['Канцелярская лавка ночью', 'A detailed cozy shop interior shows drawers, paper rolls, notebooks without text, lamps, ribbons, and a rainy window.', ['shop', 'stationery', 'night']],
    ]},
  ]},
  { id: 'col_spooky-cute', slug: 'spooky-cute', title: 'Spooky Cute', access: 'premium', theme: 'spooky', mood: 'cozy', season: ['autumn', 'halloween'], albums: [
    { id: 'alb_spooky-cute_kind-ghosts', slug: 'kind-ghosts', title: 'Добрые привидения', scenes: [
      ['Привидение с тыквенным фонариком', 'A friendly original ghost carries a small pumpkin lantern through a leaf-filled garden gate.', ['ghost', 'pumpkin', 'garden']],
      ['Призрачный чайник', 'A tiny ghost floats beside a tea tray, teapot, cookies, and a curtain with moon shapes outside.', ['ghost', 'tea', 'cookies']],
      ['Домик для привидений', 'A crooked but cozy ghost cottage has a round door, lanterns, vines, bats, and a winding path.', ['ghost-house', 'lanterns', 'bats']],
      ['Привидение в библиотеке', 'A cute ghost hovers among blank books, a ladder, reading chair, cobwebs, and a moon window.', ['ghost', 'library', 'moon']],
      ['Ночная прогулка с фонарями', 'Several original friendly ghosts carry lanterns along a path with pumpkins, mushrooms, and bare trees.', ['ghosts', 'lanterns', 'path']],
      ['Призрачный садовник', 'A ghost gardener tends moonflowers with a watering can, wheelbarrow, greenhouse, and tiny bats.', ['ghost', 'gardening', 'moonflowers']],
      ['Бал призраков на чердаке', 'A detailed attic gathering of friendly ghosts includes curtains, lanterns, music stand, cobwebs, and old trunks.', ['ghosts', 'attic', 'ball']],
      ['Привидения и лунный карнавал', 'A detailed night carnival has friendly ghosts, carousel horses, lantern arches, stalls, and a crescent moon.', ['ghosts', 'carnival', 'moon']],
      ['Большой призрачный поезд', 'A detailed ghost train travels through hills with floating passengers, lantern windows, bridges, and bats.', ['ghost-train', 'hills', 'bats']],
      ['Тихий отель для привидений', 'A detailed whimsical hotel lobby contains ghost guests, bell desk, stairs, chandeliers, plants, and blank room plaques.', ['hotel', 'ghosts', 'lobby']],
    ]},
    { id: 'alb_spooky-cute_witches-cafe', slug: 'witches-cafe', title: 'Ведьмино кафе', scenes: [
      ['Котёл какао', 'A friendly witch café counter serves cocoa from a round cauldron with mugs, spoons, and herbs.', ['witch', 'cocoa', 'café']],
      ['Кот на барной стойке', 'An original black cat sits beside a witch café counter with teapot, pastries, broom, and plants.', ['cat', 'witch', 'counter']],
      ['Пекарня лунных булочек', 'A small witch bakery displays moon-shaped buns, oven mitts, herbs, and a window with stars.', ['witch', 'bakery', 'moon']],
      ['Столик под летучими мышами', 'A café table with tea, cake, and a tiny spellbook without text sits under friendly bats and hanging vines.', ['café', 'bats', 'cake']],
      ['Терраса на крыше', 'A witch café rooftop terrace has parasols, teapot, herb pots, broom, lanterns, and skyline rooftops.', ['rooftop', 'witch', 'herbs']],
      ['Бариста с совой', 'An original witch barista serves a drink while a small owl perches near shelves of jars without labels.', ['witch', 'owl', 'barista']],
      ['Кафе в старом трамвае', 'A detailed magical café occupies a vintage tram with cauldrons, pastry shelves, lamps, and night windows.', ['tram', 'café', 'magic']],
      ['Лаборатория сиропов', 'A detailed witch café kitchen holds bottles without labels, herbs, copper pots, shelves, and a moonlit window.', ['kitchen', 'syrups', 'herbs']],
      ['Осенний фестиваль пирогов', 'A detailed witch café courtyard hosts pie tables, lanterns, pumpkins, broom parking, and friendly customers.', ['festival', 'pies', 'courtyard']],
      ['Ночная кофейня на облаке', 'A detailed fantasy café floats on a cloud with a counter, hanging lanterns, moon, stairs, and starry sky.', ['cloud-café', 'moon', 'lanterns']],
    ]},
  ]},
  { id: 'col_enchanted-forest', slug: 'enchanted-forest', title: 'Enchanted Forest', access: 'premium', theme: 'fantasy', mood: 'calm', season: ['evergreen'], albums: [
    { id: 'alb_enchanted-forest_magical-creatures', slug: 'magical-creatures', title: 'Волшебные существа', scenes: [
      ['Оленёнок с цветочной короной', 'An original young deer stands in a fern clearing with a flower crown, mushrooms, and a stream.', ['deer', 'flowers', 'stream']],
      ['Сонная сова-хранитель', 'A gentle original owl rests on a branch above a lantern, crystals, vines, and a winding path.', ['owl', 'lantern', 'crystals']],
      ['Дракончик и чайный сад', 'A small original dragon curls beside a tea table in a garden of oversized leaves and stones.', ['dragon', 'tea', 'garden']],
      ['Лягушка-музыкант', 'An original frog plays a tiny string instrument on a mossy stage among reeds, mushrooms, and fireflies.', ['frog', 'music', 'moss']],
      ['Белка-архивариус', 'An original squirrel carries acorns through a tree archive with ladders, scroll-like blank sheets, and roots.', ['squirrel', 'archive', 'tree']],
      ['Крылатая лисица у ручья', 'An original winged fox rests beside a stream with ferns, stepping stones, flowers, and a bridge.', ['fox', 'wings', 'stream']],
      ['Садовый единорог без символов', 'An original gentle unicorn grazes in a moon garden with trellis, flowers, fountain, and lanterns.', ['unicorn', 'garden', 'moon']],
      ['Лесной оркестр существ', 'A detailed group of original forest creatures plays simple instruments on a leaf-covered woodland stage.', ['creatures', 'orchestra', 'stage']],
      ['Корабельный дракон в кронах', 'A detailed original dragon navigates a treetop river between giant branches, bridges, nests, and floating leaves.', ['dragon', 'treetops', 'river']],
      ['Дворец бабочек и оленей', 'A detailed original deer sanctuary uses arches, ponds, butterflies, ferns, flowers, and layered forest paths.', ['deer', 'butterflies', 'sanctuary']],
    ]},
    { id: 'alb_enchanted-forest_secret-trails', slug: 'secret-trails', title: 'Тайные тропы', scenes: [
      ['Дверь в корнях', 'A small round door hidden among roots opens onto a path marked by stones, ferns, and a lantern.', ['root-door', 'path', 'lantern']],
      ['Мост из ветвей', 'A curved branch bridge crosses a mistless ravine with mushrooms, vines, and a tiny satchel on the rail.', ['bridge', 'branches', 'vines']],
      ['Карта светящихся троп', 'A blank map rests on a stump surrounded by branching paths, lantern flowers, compass, and moss.', ['map', 'paths', 'moss']],
      ['Лесная лестница', 'Stone steps climb through trees past lanterns, roots, flowers, and a small overlook.', ['stairs', 'forest', 'overlook']],
      ['Секретный сад за живой изгородью', 'A hidden garden gate reveals a fountain, bench, vine arch, and winding stone path.', ['garden', 'gate', 'fountain']],
      ['Тропа над водопадом', 'A narrow safe walkway follows a waterfall cliff with rail, ferns, crystals, and distant hills.', ['waterfall', 'walkway', 'cliff']],
      ['Ночной круг камней', 'A quiet stone circle sits in a forest clearing with lanterns, mushrooms, trees, and an open sky.', ['stone-circle', 'night', 'lanterns']],
      ['Дворец в полом дереве', 'A detailed interior trail leads through a hollow tree palace with stairs, windows, rooms, and roots.', ['tree-palace', 'interior', 'stairs']],
      ['Плавучие острова тропы', 'A detailed fantasy route crosses small floating islands linked by bridges with trees, waterfalls, and birds.', ['floating-islands', 'bridges', 'waterfalls']],
      ['Хрустальная станция леса', 'A detailed original forest station has a crystal canopy, tracks, benches, lanterns, and multiple branching paths.', ['station', 'crystal', 'forest']],
    ]},
  ]},
  { id: 'col_mystic-outlands', slug: 'mystic-outlands', title: 'Mystic Outlands', access: 'premium', theme: 'fantasy', mood: 'focus', season: ['evergreen'], albums: [
    { id: 'alb_mystic-outlands_fairy-lands', slug: 'fairy-lands', title: 'Сказочные земли', scenes: [
      ['Долина воздушных мостов', 'A broad fantasy valley has suspended bridges, rounded cliffs, rivers, tiny homes, and a central tower.', ['valley', 'bridges', 'tower']],
      ['Город на спине гиганта', 'An original gentle giant creature carries a small village of roofs, gardens, bridges, and windmills.', ['giant', 'village', 'windmills']],
      ['Пустынный сад колодцев', 'A fantasy desert garden surrounds a stone well with palms, arches, rugs, water jars, and dunes.', ['desert', 'garden', 'well']],
      ['Облачные пастбища', 'Floating meadows hold original cloud sheep, fences, wind flowers, paths, and a small weather station.', ['clouds', 'sheep', 'meadow']],
      ['Река под стеклянным небом', 'A crystal-roofed valley features a river, boats, village docks, mountains, and hanging gardens.', ['river', 'boats', 'mountains']],
      ['Лесная ярмарка странников', 'An open-air fantasy market has tents, wagons, lanterns, baskets, plants, and original travelers.', ['market', 'wagons', 'travelers']],
      ['Домик на краю мира', 'A tiny house balances on a cliff above clouds with telescope, garden, windmill, and winding steps.', ['cliff-house', 'telescope', 'clouds']],
      ['Долина зеркальных озёр', 'A detailed landscape layers reflective lakes, bridges, boats, cliffs, villages, and tall ornamental reeds.', ['lakes', 'bridges', 'landscape']],
      ['Город семи башен', 'A detailed original city uses seven distinct towers, hanging gardens, bridges, plazas, and distant hills.', ['city', 'towers', 'gardens']],
      ['Праздник воздушных кораблей', 'A detailed fantasy port launches original airships above docks, towers, market tents, and layered clouds.', ['airships', 'port', 'clouds']],
    ]},
    { id: 'alb_mystic-outlands_lost-temples', slug: 'lost-temples', title: 'Затерянные храмы', scenes: [
      ['Ступени к древнему саду', 'Stone stairs lead to an overgrown temple garden with urns, vines, palms, and a central fountain.', ['temple', 'stairs', 'garden']],
      ['Храм у водопада', 'A small original temple stands beside a waterfall with bridges, ferns, carved stones, and a quiet pool.', ['temple', 'waterfall', 'pool']],
      ['Пустынные колонны', 'Tall stone columns rise from dunes with an arch, travel pack, palms, and a path marked by pots.', ['ruins', 'desert', 'columns']],
      ['Храм в лесном круге', 'A mossy temple sits inside a ring of trees with lanterns, roots, stones, and an open doorway.', ['temple', 'forest', 'moss']],
      ['Обсерватория на руинах', 'A ruined hilltop observatory has a telescope, stairs, broken arches, vines, and layered mountain views.', ['observatory', 'ruins', 'mountains']],
      ['Сад каменных птиц', 'An original temple courtyard contains abstract bird sculptures, pools, flowers, columns, and paths.', ['courtyard', 'sculptures', 'flowers']],
      ['Подземная библиотека храма', 'A detailed underground temple library uses arches, ladders, blank stone tablets, lanterns, and roots.', ['library', 'underground', 'temple']],
      ['Храм над облаками', 'A detailed high-altitude temple has terraces, bridges, prayer-like flags without symbols, gardens, and cloud layers.', ['temple', 'clouds', 'terraces']],
      ['Затопленные залы', 'A detailed original ruin emerges from a shallow lagoon with columns, boats, aquatic plants, and stairs.', ['ruins', 'lagoon', 'columns']],
      ['Лабиринт храма солнца', 'A detailed desert temple maze combines arches, courtyards, stairways, palms, water channels, and a tall sun opening.', ['maze', 'temple', 'desert']],
    ]},
  ]},
  { id: 'col_moon-stars', slug: 'moon-stars', title: 'Moon & Stars', access: 'premium', theme: 'celestial', mood: 'calm', season: ['evergreen'], albums: [
    { id: 'alb_moon-stars_moon-gardens', slug: 'moon-gardens', title: 'Лунные сады', scenes: [
      ['Лунный пруд с кувшинками', 'A moon garden pond has lily pads, crescent flowers, reeds, stepping stones, and a bench.', ['moon', 'pond', 'lilies']],
      ['Ночной сад на крыше', 'A rooftop moon garden includes trellises, lanterns, pots, telescope, and layered city roofs.', ['rooftop', 'moon', 'garden']],
      ['Сад серебряных деревьев', 'Original tall trees with simple leaf clusters surround a path, fountain, and moon-shaped gate.', ['trees', 'gate', 'fountain']],
      ['Теплица под полной луной', 'A small glasshouse under a full moon contains night-blooming flowers, benches, and watering tools.', ['greenhouse', 'moon', 'flowers']],
      ['Лунный сад с совой', 'A gentle original owl rests near a moon garden with flowers, stones, lantern, and curved path.', ['owl', 'garden', 'moon']],
      ['Садовый мостик в тумане без тумана', 'A clear night garden uses a bridge, water channel, flowers, lanterns, and tall ornamental grasses.', ['bridge', 'water', 'flowers']],
      ['Купол ночных растений', 'A detailed botanical dome shows tiered moon flowers, paths, lanterns, vines, and an arched sky window.', ['dome', 'botanical', 'night']],
      ['Лунный дворец-оранжерея', 'A detailed fantasy conservatory palace has terraces, fountains, arches, plants, and a large crescent roof.', ['palace', 'greenhouse', 'moon']],
      ['Сад на летающем острове', 'A detailed floating island garden uses a gazebo, waterfall, bridges, flowers, and starry sky.', ['floating-island', 'garden', 'waterfall']],
      ['Ночная оранжерея бабочек', 'A detailed moonlit greenhouse is filled with original moths, flowers, spiral paths, benches, and glass panels.', ['moths', 'greenhouse', 'flowers']],
    ]},
    { id: 'alb_moon-stars_cosmic-dreams', slug: 'cosmic-dreams', title: 'Космические сны', scenes: [
      ['Космический кемпинг', 'A tiny camping platform floats among planets with tent, telescope, backpack, and tethered lantern.', ['space', 'camp', 'telescope']],
      ['Котёнок на луне', 'An original kitten sits on a crescent moon beside a flagless telescope, stars, and small planets.', ['kitten', 'moon', 'space']],
      ['Космический садовник', 'An original gardener tends floating plants in a space greenhouse with planets visible beyond.', ['gardener', 'greenhouse', 'space']],
      ['Маяк на астероиде', 'A tiny lighthouse stands on an asteroid with steps, antenna, satellite, and distant rings.', ['asteroid', 'lighthouse', 'rings']],
      ['Чайная станция на орбите', 'A cozy orbital station has a round table, tea set, porthole, plants, and floating notebooks without text.', ['space-station', 'tea', 'plants']],
      ['Летающая библиотека', 'A whimsical space library craft carries blank books, curved windows, plants, and a small captain chair.', ['library', 'spaceship', 'books']],
      ['Космический рынок', 'A detailed orbital market uses stalls, fruit-like planets, domes, robots with simple bodies, and star windows.', ['market', 'orbit', 'domes']],
      ['Обсерватория на комете', 'A detailed observatory travels on a comet with telescope, ladders, ice shapes, orbiting satellites, and stars.', ['comet', 'observatory', 'satellites']],
      ['Город среди колец планеты', 'A detailed original city floats among planetary rings with bridges, domes, towers, and small airships.', ['city', 'planet-rings', 'airships']],
      ['Космический сон в баллоне', 'A detailed sleeping pod drifts through a star garden with moons, planets, plants, and layered orbital paths.', ['sleep-pod', 'stars', 'planets']],
    ]},
  ]},
  { id: 'col_vamp-romantic', slug: 'vamp-romantic', title: 'Vamp Romantic', access: 'premium', theme: 'gothic-romantic', mood: 'cozy', season: ['evergreen'], albums: [
    { id: 'alb_vamp-romantic_night-mansion', slug: 'night-mansion', title: 'Ночной особняк', scenes: [
      ['Ворота ночного особняка', 'A romantic gothic mansion gate has ironwork curls, roses, moon, lanterns, and a winding path.', ['mansion', 'gate', 'roses']],
      ['Каминная библиотека', 'A cozy old library has a fireplace, blank books, armchair, tall window, candles without flames, and vines.', ['library', 'fireplace', 'books']],
      ['Музыкальная лестница', 'A grand stair hall holds a piano, curved staircase, portraits without faces or text, plants, and chandeliers.', ['stairs', 'piano', 'hall']],
      ['Розовая оранжерея', 'A gothic conservatory contains rose arches, a bench, fountain, potted vines, and moonlit panes.', ['conservatory', 'roses', 'fountain']],
      ['Чайный стол в башне', 'A round tower room presents a tea table, arched window, layered curtains, flowers, and a telescope.', ['tower', 'tea', 'window']],
      ['Двор с фонтаном', 'A mansion courtyard has a central fountain, hedges, stone urns, lanterns, and a tall façade.', ['courtyard', 'fountain', 'hedges']],
      ['Чердачный зимний сад', 'A detailed attic garden has roof windows, climbing roses, trunks, statues, benches, and lanterns.', ['attic', 'garden', 'roses']],
      ['Ночной балкон над городом', 'A detailed balcony scene layers wrought iron, curtains, telescope, roses, lamps, and distant rooftops.', ['balcony', 'night-city', 'roses']],
      ['Тайный зал портретов', 'A detailed mansion gallery uses blank oval frames, arches, plants, statues, rugs, and a spiral stair.', ['gallery', 'frames', 'stairs']],
      ['Особняк на скале', 'A detailed gothic mansion overlooks the sea from a cliff with paths, gates, terraces, cypress trees, and moon.', ['mansion', 'cliff', 'sea']],
    ]},
    { id: 'alb_vamp-romantic_roses-stained-glass', slug: 'roses-stained-glass', title: 'Розы и витражи', scenes: [
      ['Роза в высокой вазе', 'A single original rose bouquet in a tall vase stands before a geometric stained-glass window.', ['rose', 'vase', 'window']],
      ['Витражная лавка цветов', 'A gothic flower shop uses arched glass, buckets, ribbons, vines, and a stone counter.', ['flower-shop', 'glass', 'vines']],
      ['Розовая беседка', 'A romantic garden gazebo is covered with roses and framed by a path, bench, urns, and lanterns.', ['gazebo', 'roses', 'garden']],
      ['Окно с лунными узорами', 'A tall window with abstract moon-like panes overlooks a table with flowers, book, and candle holders.', ['window', 'moon', 'table']],
      ['Витражный коридор', 'A long corridor has repeated abstract stained-glass panels, arches, runners, plants, and rose vases.', ['corridor', 'glass', 'roses']],
      ['Розовый фонтан', 'A stone fountain surrounded by climbing roses, benches, urns, and geometric windows creates a courtyard.', ['fountain', 'roses', 'courtyard']],
      ['Бал в зимнем саду', 'A detailed conservatory ballroom combines tall glass, roses, chandeliers, a small orchestra, and patterned floor.', ['ballroom', 'conservatory', 'roses']],
      ['Витражный поезд ночью', 'A detailed vintage train carriage uses abstract colored-glass shapes rendered only as linework, lamps, seats, and roses.', ['train', 'glass', 'roses']],
      ['Розовый лабиринт', 'A detailed garden maze uses rose arches, stone paths, fountains, lanterns, and a distant stained-glass pavilion.', ['maze', 'roses', 'pavilion']],
      ['Собор цветов без символов', 'A detailed original floral hall has rose columns, abstract window panels, benches, stairs, and a central bouquet.', ['floral-hall', 'windows', 'roses']],
    ]},
  ]},
  { id: 'col_dream-interiors', slug: 'dream-interiors', title: 'Dream Interiors', access: 'premium', theme: 'interiors', mood: 'cozy', season: ['evergreen'], albums: [
    { id: 'alb_dream-interiors_dark-cottage', slug: 'dark-cottage', title: 'Dark Cottage', scenes: [
      ['Коттеджная кухня в сумерках', 'A dark cottage kitchen uses open shelves, kettle, herbs, table, window, and a woven basket.', ['cottage', 'kitchen', 'herbs']],
      ['Каминный угол с креслом', 'A cozy cottage corner has a stone hearth, armchair, basket of logs, blanket, and plants.', ['cottage', 'fireplace', 'chair']],
      ['Спальня с балдахином', 'A cottage bedroom uses a canopy bed, chest, window, flower vase, rug, and hanging lantern.', ['bedroom', 'canopy', 'lantern']],
      ['Тёмная оранжерея', 'A cottage greenhouse has dense but clear plant silhouettes, bench, pots, watering can, and glass roof.', ['greenhouse', 'plants', 'bench']],
      ['Лестница к мансарде', 'A narrow cottage stair has shelves, coats, baskets, plants, and an open roof window.', ['stairs', 'attic', 'baskets']],
      ['Рабочий стол у камня', 'A writing desk sits beside a stone wall with blank papers, quill-like pen, lamp, herbs, and drawers.', ['desk', 'stone', 'writing']],
      ['Гостиная с зимним садом', 'A detailed cottage living room opens into a glass garden with sofa, shelves, hearth, and layered vines.', ['living-room', 'winter-garden', 'sofa']],
      ['Подземная винтажная кухня', 'A detailed original cottage kitchen below ground has arched masonry, pantry shelves, table, herbs, and lamps.', ['kitchen', 'pantry', 'arches']],
      ['Чердак ремесленника', 'A detailed cottage attic studio layers loom, baskets, fabric, tools, beams, and a small dormer window.', ['attic', 'craft', 'loom']],
      ['Домик у тёмного озера', 'A detailed cottage interior overlooks a lake with porch, reading corner, fireplace, plants, and layered windows.', ['cottage', 'lake', 'interior']],
    ]},
    { id: 'alb_dream-interiors_neo-deco-rooms', slug: 'neo-deco-rooms', title: 'Neo Deco Rooms', scenes: [
      ['Геометрическая гостиная', 'A refined room uses fan-shaped panels, curved sofa, geometric rug, lamp, plants, and a low table.', ['interior', 'geometry', 'sofa']],
      ['Деко-бар без брендов', 'A small art-deco home bar has arches, glass shapes, stools, shelves, and a vase without labels.', ['bar', 'arches', 'interior']],
      ['Круглая спальня', 'A circular bedroom uses a round bed, radial ceiling, side tables, curtains, and a geometric window.', ['bedroom', 'round', 'geometry']],
      ['Музыкальный салон', 'An elegant salon has piano, curved chairs, patterned panels, plants, and a central chandelier.', ['salon', 'piano', 'chairs']],
      ['Деко-оранжерея', 'A geometric conservatory combines tiered plants, stepped benches, arched windows, and a bold floor pattern.', ['conservatory', 'geometry', 'plants']],
      ['Кабинет с веерным окном', 'A study uses a fan window, writing desk, blank books, lamp, plant, and symmetrical cabinets.', ['study', 'window', 'desk']],
      ['Галерея круглых дверей', 'A detailed interior corridor has repeated circular doors, sculptural plants, rugs, lamps, and framed panels.', ['corridor', 'doors', 'geometry']],
      ['Плавучий деко-театр', 'A detailed fantasy interior is a floating theater with curved balconies, stage, curtains, lamps, and patterned floors.', ['theater', 'balconies', 'stage']],
      ['Ночной отельный холл', 'A detailed art-deco-inspired lobby uses sweeping stairs, lamps, plants, seating, and blank plaque shapes.', ['hotel', 'lobby', 'stairs']],
      ['Комната с панорамным окном', 'A detailed room frames a city skyline with curved furniture, plants, table, rugs, and layered geometric panels.', ['room', 'city', 'panorama']],
    ]},
  ]},
  { id: 'col_glamour-fashion', slug: 'glamour-fashion', title: 'Glamour & Fashion', access: 'premium', theme: 'fashion', mood: 'focus', season: ['evergreen'], albums: [
    { id: 'alb_glamour-fashion_vintage-glam', slug: 'vintage-glam', title: 'Vintage Glam', scenes: [
      ['Платье на манекене', 'An elegant original dress on a mannequin stands in a studio with mirror, hatbox, gloves, and flowers.', ['fashion', 'dress', 'studio']],
      ['Туфли у туалетного столика', 'Vintage shoes, a vanity mirror, perfume bottles without labels, gloves, and a small bouquet form a still life.', ['shoes', 'vanity', 'bouquet']],
      ['Шляпная мастерская', 'A milliner studio displays hats, ribbons, mannequin, scissors, shelves, and a round mirror.', ['hats', 'studio', 'ribbons']],
      ['Пальто на вешалке', 'A tailored coat hangs on a rack beside umbrella, boots, scarf, and a travel trunk.', ['coat', 'rack', 'trunk']],
      ['Показ в маленьком театре', 'An original model walks a small stage with curtains, seats, spot-shape, and clothing display.', ['runway', 'theater', 'fashion']],
      ['Сумочки на витрине', 'A boutique window displays varied handbags, hat, scarf, flowers, and decorative panels without logos.', ['handbags', 'boutique', 'window']],
      ['Утренний гардероб', 'A detailed dressing room has clothing racks, mirror, chair, vanity, boxes without labels, and layered garments.', ['dressing-room', 'mirror', 'wardrobe']],
      ['Вечерний показ на крыше', 'A detailed rooftop fashion show uses skyline, lamps, runway, original outfits, plants, and seating.', ['rooftop', 'runway', 'city']],
      ['Костюмерная большого театра', 'A detailed theater costume room layers garments, dress forms, rails, ladders, mirrors, and sewing tables.', ['costumes', 'theater', 'studio']],
      ['Винтажный поезд моды', 'A detailed fashion carriage has racks, trunks, mirrors, seats, travel hats, and an original traveling stylist.', ['train', 'fashion', 'travel']],
    ]},
    { id: 'alb_glamour-fashion_jewelry-accessories', slug: 'jewelry-accessories', title: 'Украшения и аксессуары', scenes: [
      ['Браслеты на подушке', 'A jewelry cushion displays original bracelets with beads, clasp shapes, ribbons, and a small magnifying glass.', ['bracelets', 'jewelry', 'display']],
      ['Шкатулка с серьгами', 'An open jewelry box contains abstract earrings, comb, ribbon, flowers, and a vanity mirror.', ['jewelry-box', 'earrings', 'vanity']],
      ['Мастерская бус', 'A bead workshop has trays, thread, tools, charms without symbols, and a careful worktable.', ['beads', 'workshop', 'tools']],
      ['Очки и шёлковый шарф', 'Round glasses and a folded scarf sit beside a handbag, mirror, and vase on a dressing table.', ['glasses', 'scarf', 'table']],
      ['Брошь в форме листа', 'An original leaf-shaped brooch rests on fabric beside pins, thread, and botanical sketches without text.', ['brooch', 'leaf', 'fabric']],
      ['Пояса и перчатки', 'A boutique display arranges belts, gloves, hat, mirror, and decorative hooks without brands.', ['belts', 'gloves', 'boutique']],
      ['Витрина украшений в арке', 'A detailed jewelry boutique uses arched cases, necklaces, rings, lamps, plants, and patterned floor.', ['boutique', 'necklaces', 'rings']],
      ['Карнавал масок без символов', 'A detailed accessory studio displays original masks, feathers, gloves, ribbons, mirrors, and layered shelves.', ['masks', 'feathers', 'studio']],
      ['Сад драгоценных форм', 'A detailed fantasy jewelry garden uses oversized abstract gems, bridges, flowers, fountains, and display plinths.', ['fantasy', 'gems', 'garden']],
      ['Ночная мастерская ювелира', 'A detailed jeweler workshop has bench, magnifier, trays, tools, lamps, drawers, and original ornamental pieces.', ['jeweler', 'workbench', 'tools']],
    ]},
  ]},
  { id: 'col_winter-wishes', slug: 'winter-wishes', title: 'Winter Wishes', access: 'premium', theme: 'winter', mood: 'cozy', season: ['winter', 'christmas'], albums: [
    { id: 'alb_winter-wishes_first-snow', slug: 'first-snow', title: 'Первый снег', scenes: [
      ['Первый снег у фонаря', 'A quiet street lamp, snow-covered bench, boots, bare trees, and a small scarf mark the first snowfall.', ['snow', 'streetlamp', 'bench']],
      ['Снежный дворик', 'A cottage courtyard has a snowman-like simple figure without facial detail, sled, lantern, trees, and steps.', ['courtyard', 'snow', 'sled']],
      ['Следы на свежем снегу', 'Footprints cross a snowy path toward a cabin with stacked wood, lantern, fence, and pine branches.', ['footprints', 'cabin', 'snow']],
      ['Окно с зимними ветками', 'A window ledge holds a mug, knit mitten, vase of bare branches, and snow-covered rooftops outside.', ['window', 'mug', 'winter']],
      ['Снег в городском саду', 'A city garden in fresh snow has an iron gate, bench, bicycle, lamps, and layered trees.', ['city-garden', 'snow', 'bicycle']],
      ['Каток у старой башни', 'An outdoor skating rink sits beneath a clock tower without lettering with benches, lamps, trees, and skates.', ['skating', 'tower', 'rink']],
      ['Снежная остановка', 'A small transit shelter in snow has a bench, umbrella, thermos, tracks, and distant cozy windows.', ['shelter', 'snow', 'transit']],
      ['Ночной снегопад над площадью', 'A detailed winter square layers lamps, trees, stalls, footprints, benches, and a softly outlined snowfall.', ['square', 'snow', 'lanterns']],
      ['Ледяная оранжерея', 'A detailed winter conservatory has frosted panes, plants, benches, lanterns, and a snow-covered roof.', ['greenhouse', 'winter', 'plants']],
      ['Снежный поезд в горах', 'A detailed train crosses a snowy mountain valley with station, bridge, pines, lanterns, and layered peaks.', ['train', 'mountains', 'snow']],
    ]},
    { id: 'alb_winter-wishes_winter-city-lights', slug: 'winter-city-lights', title: 'Огни зимнего города', scenes: [
      ['Окна в снегу', 'A row of cozy city windows, balconies, lamps, snow roofs, and a small street tree form a winter facade.', ['city', 'windows', 'snow']],
      ['Ночной трамвай', 'A vintage tram moves through snow with lamps, tracks, benches, trees, and warm building windows.', ['tram', 'snow', 'city']],
      ['Площадь с горячим напитком', 'A market square has a hot-drink cart, umbrellas, benches, garlands as simple loops, and snowy roofs.', ['market', 'drink', 'square']],
      ['Зимний мост', 'A city bridge crosses a river with lamps, pedestrians, bicycles, snow banks, and reflected architecture.', ['bridge', 'river', 'winter']],
      ['Книжный магазин без вывески', 'A cozy bookshop facade without lettering has a window display, awning, bicycle, tree, and snow.', ['bookshop', 'window', 'snow']],
      ['Кафе на углу', 'A corner café has outdoor tables, winter blankets, lamps, flower boxes, and a snowy street.', ['café', 'street', 'snow']],
      ['Почтовая площадь', 'A winter plaza includes mailboxes, parcels without labels, benches, lamp posts, market trees, and snow.', ['mail', 'plaza', 'snow']],
      ['Фонарный переулок', 'A detailed narrow alley uses overhead lamps, balconies, bicycles, snow piles, plants, and distant square.', ['alley', 'lanterns', 'city']],
      ['Зимний вокзал ночью', 'A detailed city station shows platforms, trains, clock without lettering, luggage, lamps, and snowy tracks.', ['station', 'train', 'night']],
      ['Городской праздник света', 'A detailed winter boulevard has light arches without text, stalls, trams, trees, bridges, and layered buildings.', ['boulevard', 'lights', 'city']],
    ]},
  ]},
];

if (collections.length !== 16) throw new Error(`Expected 16 collections, got ${collections.length}`);
if (collections.reduce((sum, collection) => sum + collection.albums.length, 0) !== 32) throw new Error('Expected 32 albums');

function promptFor({ collection, album, scene, difficulty, orientation }) {
  const [title, description, tags] = scene;
  const safeDescription = description.replace(/\bsculptures?\b/gi, 'abstract stone forms');
  const dims = dimensions[orientation];
  return [
    'Use case: illustration-story',
    'Asset type: original digital coloring page for the Splint catalog',
    `Primary request: ${safeDescription}`,
    `Subject: ${title}; supporting motifs: ${tags.join(', ')}`,
    `Collection direction: ${collection.title}; album direction: ${album.title}`,
    `Composition/framing: ${orientation}, keep at least 7% clear breathing space around key subjects, use a full-bleed scene background with no external border or frame, strong readable silhouette and clear foreground/midground/background hierarchy`,
    `Master canvas: ${dims.width}×${dims.height}`,
    `Difficulty: ${difficulty}; target approximately ${difficulty === 'simple' ? '15–35' : difficulty === 'medium' ? '25–60' : '40–80'} useful tappable regions, use large and medium bounded color regions and a mobile-readable thumbnail`,
    'Style/medium: finished full-color artwork for a premium digital tap-to-fill coloring app, sophisticated contemporary illustration, clean smooth vector-like contour lines, deliberate bounded color regions, vibrant harmonious palette, expressive atmospheric lighting, clear focal hierarchy, original subjects only',
    'Every intended colorable region must be completely enclosed by a continuous opaque boundary that remains closed after downsampling. Keep at least 7% clear breathing space around the key subjects inside the scene; the background must run full-bleed to the canvas edge, with no artificial white border or frame. Make the artwork desirable as a finished full-color illustration first, with strong focal colors, controlled contrast, color-temperature variation, and mood-appropriate light. Do not add decorative lines unless they create a meaningful tappable region. Avoid tiny fragmented cells, hatching, cross-hatching, sketch lines, texture strokes, wood grain, fur strokes, fabric-fold strokes, dense leaf-vein networks, clusters of tiny dots, raindrops, petals, bricks, scales, or hairs, arbitrary interior divider lines, narrow slivers, open boundaries, nearly-touching lines, accidental gaps, monochrome black-and-white output, grayscale-only output, muddy beige-on-beige color, random rainbow palettes, text, letters, watermark, signature, logo, trademark, copyrighted characters, franchise references, or named artist imitation',
  ].join('\n');
}

const entries = [];
const registry = [];
let albumIndex = 0;
for (const collection of collections) {
  for (const album of collection.albums) {
    const orientations = orientationPatterns[albumIndex];
    for (let index = 0; index < album.scenes.length; index += 1) {
      const [title, description, tags] = album.scenes[index];
      const difficulty = difficultyByIndex[index];
      const orientation = orientations[index];
      const dims = dimensions[orientation];
      const id = `coloring_${collection.slug}_${album.slug}_${String(index + 1).padStart(2, '0')}`;
      const slug = id.replace(/^coloring_/, '');
      const signature = `${collection.slug}|${album.slug}|${title}|${tags.join('|')}`.toLocaleLowerCase();
      const entry = {
        id,
        slug,
        title,
        description,
        collection_id: collection.id,
        collection_title: collection.title,
        album_id: album.id,
        album_title: album.title,
        access: collection.access,
        difficulty,
        orientation,
        width: dims.width,
        height: dims.height,
        grid_width: dims.grid_width,
        grid_height: dims.grid_height,
        tags: [...tags, collection.theme, collection.slug],
        season: [...new Set([...(collection.season || common.season)])],
        audience: common.audience,
        mood: collection.mood,
        generation_prompt: promptFor({ collection, album, scene: [title, description, tags], difficulty, orientation }),
        negative_constraints: negativeConstraints,
        generation_status: 'planned',
        qa_status: 'pending',
        source_asset: `content/generated/masters/${id}.png`,
        optimized_asset: `public/assets/catalog/generated/${slug}.png`,
        preview_asset: `public/assets/catalog/generated/${slug}-pixel.png`,
        semantic_signature: signature,
      };
      entries.push(entry);
      registry.push({ id, semantic_signature: signature, title, collection_id: collection.id, album_id: album.id, tags: entry.tags });
    }
    albumIndex += 1;
  }
}

if (entries.length !== 320) throw new Error(`Expected 320 entries, got ${entries.length}`);
const counts = entries.reduce((result, entry) => {
  result[entry.access] = (result[entry.access] || 0) + 1;
  result[entry.orientation] = (result[entry.orientation] || 0) + 1;
  result[entry.difficulty] = (result[entry.difficulty] || 0) + 1;
  return result;
}, {});
const expected = { free: 160, premium: 160, portrait: 220, square: 70, landscape: 30, simple: 96, medium: 128, detailed: 96 };
for (const [key, value] of Object.entries(expected)) if (counts[key] !== value) throw new Error(`${key}: expected ${value}, got ${counts[key]}`);

const collectionCovers = collections.map((collection) => ({
  id: `cover_collection_${collection.slug}`,
  kind: 'collection',
  parent_id: collection.id,
  title: collection.title,
  orientation: 'cover',
  width: 1200,
  height: 1200,
  generation_status: 'planned',
  qa_status: 'pending',
  generation_prompt: `Use case: illustration-story\nAsset type: original square full-color editorial cover for the Splint catalog\nPrimary request: a sophisticated finished full-color illustration representing the collection «${collection.title}» with a clear central motif, harmonious palette, expressive atmospheric lighting, and a layered but uncluttered composition\nStyle/medium: contemporary premium digital coloring-app artwork with clean smooth contours and deliberate bounded shapes, no embedded text\nComposition/framing: square 1200×1200, keep at least 7% clear breathing space around key motifs, full-bleed scene background to the canvas edge, no external border or frame, readable as a mobile thumbnail\nConstraints: no monochrome black-and-white output, no grayscale-only output, no muddy beige palette, no random rainbow palette, no photographic textures, no text, no letters, no watermark, no signature, no logo, no trademark, no copyrighted characters, no franchise references, no named artist imitation`,
  source_asset: `content/generated/covers/${collection.slug}.png`,
  optimized_asset: `public/assets/catalog/generated/covers/${collection.slug}.png`,
}));
const albumCovers = collections.flatMap((collection) => collection.albums.map((album) => ({
  id: `cover_album_${album.slug}`,
  kind: 'album',
  parent_id: album.id,
  collection_id: collection.id,
  title: album.title,
  orientation: 'cover',
  width: 1200,
  height: 1200,
  generation_status: 'planned',
  qa_status: 'pending',
  generation_prompt: `Use case: illustration-story\nAsset type: original square full-color editorial cover for the Splint catalog\nPrimary request: a sophisticated finished full-color illustration representing the album «${album.title}» inside the collection «${collection.title}», with a distinct central motif, harmonious palette, expressive atmospheric lighting, and a layered but uncluttered composition\nStyle/medium: contemporary premium digital coloring-app artwork with clean smooth contours and deliberate bounded shapes, no embedded text\nComposition/framing: square 1200×1200, keep at least 7% clear breathing space around key motifs, full-bleed scene background to the canvas edge, no external border or frame, readable as a mobile thumbnail\nConstraints: no monochrome black-and-white output, no grayscale-only output, no muddy beige palette, no random rainbow palette, no photographic textures, no text, no letters, no watermark, no signature, no logo, no trademark, no copyrighted characters, no franchise references, no named artist imitation`,
  source_asset: `content/generated/covers/${album.slug}.png`,
  optimized_asset: `public/assets/catalog/generated/covers/${album.slug}.png`,
})));
const covers = [...collectionCovers, ...albumCovers];

const manifest = {
  schema_version: 1,
  generated_at: '2026-09-15T00:00:00.000Z',
  art_bible: 'docs/SPLINT_ART_BIBLE.md',
  catalog: { collections: 16, albums: 32, colorings: 320, free: 160, premium: 160 },
  master_formats: {
    portrait: { width: 1600, height: 2000 },
    square: { width: 1600, height: 1600 },
    landscape: { width: 2000, height: 1500 },
    cover: { width: 1200, height: 1200 },
  },
  collections: collections.map(({ id, slug, title, access, theme, mood, season, albums }) => ({
    id, slug, title, access, theme, mood, season,
    albums: albums.map(({ id: albumId, slug: albumSlug, title: albumTitle }) => ({ id: albumId, slug: albumSlug, title: albumTitle, count: 10 })),
  })),
  covers,
  entries,
};

await mkdir(dirname(manifestPath), { recursive: true });
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await writeFile(registryPath, `${JSON.stringify({ schema_version: 1, entries: registry }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ manifestPath, registryPath, counts }, null, 2));
