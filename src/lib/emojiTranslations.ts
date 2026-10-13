/**
 * Multi-language emoji search translations
 * Supports: English, German, French, Spanish, Italian, Portuguese, Dutch, Russian
 */

export const EMOJI_TRANSLATIONS: Record<string, string[]> = {
  // Colors
  'black': ['schwarz', 'noir', 'negro', 'nero', 'preto', 'zwart', 'черный'],
  'white': ['weiß', 'blanc', 'blanco', 'bianco', 'branco', 'wit', 'белый'],
  'red': ['rot', 'rouge', 'rojo', 'rosso', 'vermelho', 'rood', 'красный'],
  'blue': ['blau', 'bleu', 'azul', 'blu', 'azul', 'blauw', 'синий'],
  'green': ['grün', 'vert', 'verde', 'verde', 'verde', 'groen', 'зелёный'],
  'yellow': ['gelb', 'jaune', 'amarillo', 'giallo', 'amarelo', 'geel', 'жёлтый'],
  'orange': ['orange', 'orange', 'naranja', 'arancione', 'laranja', 'oranje', 'оранжевый'],
  'purple': ['lila', 'violet', 'morado', 'viola', 'roxo', 'paars', 'фиолетовый'],
  'pink': ['rosa', 'rose', 'rosa', 'rosa', 'rosa', 'roze', 'розовый'],
  'brown': ['braun', 'brun', 'marrón', 'marrone', 'marrom', 'bruin', 'коричневый'],
  'gray': ['grau', 'gris', 'gris', 'grigio', 'cinza', 'grijs', 'серый'],
  'grey': ['grau', 'gris', 'gris', 'grigio', 'cinza', 'grijs', 'серый'],

  // Emotions
  'happy': ['glücklich', 'heureux', 'feliz', 'felice', 'feliz', 'blij', 'счастливый'],
  'sad': ['traurig', 'triste', 'triste', 'triste', 'triste', 'verdrietig', 'грустный'],
  'angry': ['wütend', 'en colère', 'enojado', 'arrabbiato', 'zangado', 'boos', 'злой'],
  'love': ['liebe', 'amour', 'amor', 'amore', 'amor', 'liefde', 'любовь'],
  'heart': ['herz', 'cœur', 'corazón', 'cuore', 'coração', 'hart', 'сердце'],
  'smile': ['lächeln', 'sourire', 'sonrisa', 'sorriso', 'sorriso', 'glimlach', 'улыбка'],
  'laugh': ['lachen', 'rire', 'reír', 'ridere', 'rir', 'lachen', 'смеяться'],
  'cry': ['weinen', 'pleurer', 'llorar', 'piangere', 'chorar', 'huilen', 'плакать'],
  'fear': ['angst', 'peur', 'miedo', 'paura', 'medo', 'angst', 'страх'],
  'surprised': ['überrascht', 'surpris', 'sorprendido', 'sorpreso', 'surpreso', 'verrast', 'удивлённый'],

  // Animals
  'cat': ['katze', 'chat', 'gato', 'gatto', 'gato', 'kat', 'кот'],
  'dog': ['hund', 'chien', 'perro', 'cane', 'cão', 'hond', 'собака'],
  'bird': ['vogel', 'oiseau', 'pájaro', 'uccello', 'pássaro', 'vogel', 'птица'],
  'fish': ['fisch', 'poisson', 'pez', 'pesce', 'peixe', 'vis', 'рыба'],
  'lion': ['löwe', 'lion', 'león', 'leone', 'leão', 'leeuw', 'лев'],
  'tiger': ['tiger', 'tigre', 'tigre', 'tigre', 'tigre', 'tijger', 'тигр'],
  'bear': ['bär', 'ours', 'oso', 'orso', 'urso', 'beer', 'медведь'],
  'monkey': ['affe', 'singe', 'mono', 'scimmia', 'macaco', 'aap', 'обезьяна'],
  'rabbit': ['kaninchen', 'lapin', 'conejo', 'coniglio', 'coelho', 'konijn', 'кролик'],
  'mouse': ['maus', 'souris', 'ratón', 'topo', 'rato', 'muis', 'мышь'],
  'cow': ['kuh', 'vache', 'vaca', 'mucca', 'vaca', 'koe', 'корова'],
  'pig': ['schwein', 'cochon', 'cerdo', 'maiale', 'porco', 'varken', 'свинья'],
  'horse': ['pferd', 'cheval', 'caballo', 'cavallo', 'cavalo', 'paard', 'лошадь'],
  'elephant': ['elefant', 'éléphant', 'elefante', 'elefante', 'elefante', 'olifant', 'слон'],
  'snake': ['schlange', 'serpent', 'serpiente', 'serpente', 'cobra', 'slang', 'змея'],
  'butterfly': ['schmetterling', 'papillon', 'mariposa', 'farfalla', 'borboleta', 'vlinder', 'бабочка'],
  'bee': ['biene', 'abeille', 'abeja', 'ape', 'abelha', 'bij', 'пчела'],
  'turtle': ['schildkröte', 'tortue', 'tortuga', 'tartaruga', 'tartaruga', 'schildpad', 'черепаха'],
  'frog': ['frosch', 'grenouille', 'rana', 'rana', 'sapo', 'kikker', 'лягушка'],
  'dragon': ['drache', 'dragon', 'dragón', 'drago', 'dragão', 'draak', 'дракон'],

  // Nature
  'sun': ['sonne', 'soleil', 'sol', 'sole', 'sol', 'zon', 'солнце'],
  'moon': ['mond', 'lune', 'luna', 'luna', 'lua', 'maan', 'луна'],
  'star': ['stern', 'étoile', 'estrella', 'stella', 'estrela', 'ster', 'звезда'],
  'cloud': ['wolke', 'nuage', 'nube', 'nuvola', 'nuvem', 'wolk', 'облако'],
  'rain': ['regen', 'pluie', 'lluvia', 'pioggia', 'chuva', 'regen', 'дождь'],
  'snow': ['schnee', 'neige', 'nieve', 'neve', 'neve', 'sneeuw', 'снег'],
  'fire': ['feuer', 'feu', 'fuego', 'fuoco', 'fogo', 'vuur', 'огонь'],
  'water': ['wasser', 'eau', 'agua', 'acqua', 'água', 'water', 'вода'],
  'tree': ['baum', 'arbre', 'árbol', 'albero', 'árvore', 'boom', 'дерево'],
  'flower': ['blume', 'fleur', 'flor', 'fiore', 'flor', 'bloem', 'цветок'],
  'rose': ['rose', 'rose', 'rosa', 'rosa', 'rosa', 'roos', 'роза'],
  'plant': ['pflanze', 'plante', 'planta', 'pianta', 'planta', 'plant', 'растение'],
  'mountain': ['berg', 'montagne', 'montaña', 'montagna', 'montanha', 'berg', 'гора'],
  'ocean': ['ozean', 'océan', 'océano', 'oceano', 'oceano', 'oceaan', 'океан'],
  'beach': ['strand', 'plage', 'playa', 'spiaggia', 'praia', 'strand', 'пляж'],

  // Food
  'food': ['essen', 'nourriture', 'comida', 'cibo', 'comida', 'eten', 'еда'],
  'fruit': ['obst', 'fruit', 'fruta', 'frutta', 'fruta', 'fruit', 'фрукт'],
  'apple': ['apfel', 'pomme', 'manzana', 'mela', 'maçã', 'appel', 'яблоко'],
  'banana': ['banane', 'banane', 'plátano', 'banana', 'banana', 'banaan', 'банан'],
  'strawberry': ['erdbeere', 'fraise', 'fresa', 'fragola', 'morango', 'aardbei', 'клубника'],
  'grape': ['traube', 'raisin', 'uva', 'uva', 'uva', 'druif', 'виноград'],
  'watermelon': ['wassermelone', 'pastèque', 'sandía', 'anguria', 'melancia', 'watermeloen', 'арбуз'],
  'pizza': ['pizza', 'pizza', 'pizza', 'pizza', 'pizza', 'pizza', 'пицца'],
  'burger': ['burger', 'burger', 'hamburguesa', 'hamburger', 'hambúrguer', 'burger', 'бургер'],
  'coffee': ['kaffee', 'café', 'café', 'caffè', 'café', 'koffie', 'кофе'],
  'tea': ['tee', 'thé', 'té', 'tè', 'chá', 'thee', 'чай'],
  'cake': ['kuchen', 'gâteau', 'pastel', 'torta', 'bolo', 'taart', 'торт'],
  'bread': ['brot', 'pain', 'pan', 'pane', 'pão', 'brood', 'хлеб'],
  'cheese': ['käse', 'fromage', 'queso', 'formaggio', 'queijo', 'kaas', 'сыр'],
  'meat': ['fleisch', 'viande', 'carne', 'carne', 'carne', 'vlees', 'мясо'],
  'egg': ['ei', 'œuf', 'huevo', 'uovo', 'ovo', 'ei', 'яйцо'],

  // Objects
  'phone': ['telefon', 'téléphone', 'teléfono', 'telefono', 'telefone', 'telefoon', 'телефон'],
  'computer': ['computer', 'ordinateur', 'computadora', 'computer', 'computador', 'computer', 'компьютер'],
  'book': ['buch', 'livre', 'libro', 'libro', 'livro', 'boek', 'книга'],
  'pencil': ['bleistift', 'crayon', 'lápiz', 'matita', 'lápis', 'potlood', 'карандаш'],
  'pen': ['stift', 'stylo', 'bolígrafo', 'penna', 'caneta', 'pen', 'ручка'],
  'camera': ['kamera', 'appareil photo', 'cámara', 'macchina fotografica', 'câmera', 'camera', 'камера'],
  'car': ['auto', 'voiture', 'coche', 'auto', 'carro', 'auto', 'машина'],
  'house': ['haus', 'maison', 'casa', 'casa', 'casa', 'huis', 'дом'],
  'key': ['schlüssel', 'clé', 'llave', 'chiave', 'chave', 'sleutel', 'ключ'],
  'lock': ['schloss', 'serrure', 'cerradura', 'serratura', 'fechadura', 'slot', 'замок'],
  'clock': ['uhr', 'horloge', 'reloj', 'orologio', 'relógio', 'klok', 'часы'],
  'watch': ['uhr', 'montre', 'reloj', 'orologio', 'relógio', 'horloge', 'часы'],
  'money': ['geld', 'argent', 'dinero', 'denaro', 'dinheiro', 'geld', 'деньги'],
  'gift': ['geschenk', 'cadeau', 'regalo', 'regalo', 'presente', 'cadeau', 'подарок'],
  'balloon': ['ballon', 'ballon', 'globo', 'palloncino', 'balão', 'ballon', 'шарик'],
  'umbrella': ['regenschirm', 'parapluie', 'paraguas', 'ombrello', 'guarda-chuva', 'paraplu', 'зонт'],

  // Activities
  'music': ['musik', 'musique', 'música', 'musica', 'música', 'muziek', 'музыка'],
  'sport': ['sport', 'sport', 'deporte', 'sport', 'esporte', 'sport', 'спорт'],
  'football': ['fußball', 'football', 'fútbol', 'calcio', 'futebol', 'voetbal', 'футбол'],
  'soccer': ['fußball', 'football', 'fútbol', 'calcio', 'futebol', 'voetbal', 'футбол'],
  'basketball': ['basketball', 'basketball', 'baloncesto', 'pallacanestro', 'basquete', 'basketbal', 'баскетбол'],
  'party': ['party', 'fête', 'fiesta', 'festa', 'festa', 'feest', 'вечеринка'],
  'dance': ['tanzen', 'danse', 'baile', 'ballo', 'dança', 'dans', 'танец'],
  'painting': ['malen', 'peinture', 'pintura', 'pittura', 'pintura', 'schilderen', 'живопись'],
  'art': ['kunst', 'art', 'arte', 'arte', 'arte', 'kunst', 'искусство'],

  // Body parts
  'hand': ['hand', 'main', 'mano', 'mano', 'mão', 'hand', 'рука'],
  'eye': ['auge', 'œil', 'ojo', 'occhio', 'olho', 'oog', 'глаз'],
  'mouth': ['mund', 'bouche', 'boca', 'bocca', 'boca', 'mond', 'рот'],
  'ear': ['ohr', 'oreille', 'oreja', 'orecchio', 'orelha', 'oor', 'ухо'],
  'nose': ['nase', 'nez', 'nariz', 'naso', 'nariz', 'neus', 'нос'],
  'foot': ['fuß', 'pied', 'pie', 'piede', 'pé', 'voet', 'нога'],
  'leg': ['bein', 'jambe', 'pierna', 'gamba', 'perna', 'been', 'нога'],
  'face': ['gesicht', 'visage', 'cara', 'faccia', 'rosto', 'gezicht', 'лицо'],

  // Common words
  'good': ['gut', 'bon', 'bueno', 'buono', 'bom', 'goed', 'хороший'],
  'bad': ['schlecht', 'mauvais', 'malo', 'cattivo', 'mau', 'slecht', 'плохой'],
  'big': ['groß', 'grand', 'grande', 'grande', 'grande', 'groot', 'большой'],
  'small': ['klein', 'petit', 'pequeño', 'piccolo', 'pequeno', 'klein', 'маленький'],
  'hot': ['heiß', 'chaud', 'caliente', 'caldo', 'quente', 'heet', 'горячий'],
  'cold': ['kalt', 'froid', 'frío', 'freddo', 'frio', 'koud', 'холодный'],
  'new': ['neu', 'nouveau', 'nuevo', 'nuovo', 'novo', 'nieuw', 'новый'],
  'old': ['alt', 'vieux', 'viejo', 'vecchio', 'velho', 'oud', 'старый'],
  'yes': ['ja', 'oui', 'sí', 'sì', 'sim', 'ja', 'да'],
  'no': ['nein', 'non', 'no', 'no', 'não', 'nee', 'нет'],
  'man': ['mann', 'homme', 'hombre', 'uomo', 'homem', 'man', 'мужчина'],
  'woman': ['frau', 'femme', 'mujer', 'donna', 'mulher', 'vrouw', 'женщина'],
  'boy': ['junge', 'garçon', 'niño', 'ragazzo', 'menino', 'jongen', 'мальчик'],
  'girl': ['mädchen', 'fille', 'niña', 'ragazza', 'menina', 'meisje', 'девочка'],
  'baby': ['baby', 'bébé', 'bebé', 'bambino', 'bebê', 'baby', 'ребёнок'],
  'child': ['kind', 'enfant', 'niño', 'bambino', 'criança', 'kind', 'ребёнок'],
  'family': ['familie', 'famille', 'familia', 'famiglia', 'família', 'familie', 'семья'],
  'friend': ['freund', 'ami', 'amigo', 'amico', 'amigo', 'vriend', 'друг'],

  // Time
  'time': ['zeit', 'temps', 'tiempo', 'tempo', 'tempo', 'tijd', 'время'],
  'day': ['tag', 'jour', 'día', 'giorno', 'dia', 'dag', 'день'],
  'night': ['nacht', 'nuit', 'noche', 'notte', 'noite', 'nacht', 'ночь'],
  'morning': ['morgen', 'matin', 'mañana', 'mattina', 'manhã', 'ochtend', 'утро'],
  'evening': ['abend', 'soir', 'tarde', 'sera', 'noite', 'avond', 'вечер'],

  // Symbols & Abstract
  'circle': ['kreis', 'cercle', 'círculo', 'cerchio', 'círculo', 'cirkel', 'круг'],
  'square': ['quadrat', 'carré', 'cuadrado', 'quadrato', 'quadrado', 'vierkant', 'квадрат'],
  'check': ['haken', 'cocher', 'verificar', 'spunta', 'verificar', 'vinkje', 'галочка'],
  'cross': ['kreuz', 'croix', 'cruz', 'croce', 'cruz', 'kruis', 'крест'],
  'question': ['frage', 'question', 'pregunta', 'domanda', 'pergunta', 'vraag', 'вопрос'],
  'exclamation': ['ausrufezeichen', 'exclamation', 'exclamación', 'esclamazione', 'exclamação', 'uitroepteken', 'восклицание'],
};

/**
 * Build reverse translation map (from any language to English keywords)
 */
export const buildReverseTranslationMap = (): Map<string, string> => {
  const map = new Map<string, string>();

  for (const [english, translations] of Object.entries(EMOJI_TRANSLATIONS)) {
    // English word maps to itself
    map.set(english.toLowerCase(), english);

    // Each translation maps to the English word
    for (const translation of translations) {
      map.set(translation.toLowerCase(), english);
    }
  }

  return map;
};
