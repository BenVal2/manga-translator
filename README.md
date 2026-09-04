# Manga Translator

Extensión de Chrome que traduce manga en sitios web usando OCR + DeepL.

## Características

- **Traducción automática** de texto en imágenes de manga
- **OCR** con OCR.space para extraer texto de bocadillos
- **Traducción** con DeepL API (6 idiomas destino)
- **Overlays interactivos** posicionados sobre las burbujas originales
- **Modo clic** para traducir regiones específicas
- **Edición manual** con persistencia en chrome.storage
- **Fusión de overlays** para bocadillos divididos
- Soporte para MangaDex y otros sitios

## Instalación

1. Clona este repositorio:
   ```bash
   git clone https://github.com/BenVal2/manga-translator.git
   ```

2. Abre Chrome y ve a `chrome://extensions/`

3. Activa el **Modo desarrollador** (esquina superior derecha)

4. Haz clic en **Cargar extensión sin empaquetar**

5. Selecciona la carpeta del repositorio

## Configuración de API Keys

Necesitas API keys gratuitas para usar la extensión:

### OCR.space (GRATIS)
1. Ve a [ocr.space/apikey](https://ocr.space/apikey)
2. Regístrate y obtén tu API key
3. La key gratuita permite **25,000 requests/mes**

### DeepL (GRATIS)
1. Ve to [deepl.com/pro-api](https://www.deepl.com/pro-api)
2. Regístrate para la **API Free**
3. La versión gratuita permite **500,000 caracteres/mes**

### Configurar en la extensión
1. Haz clic en el ícono de la extensión
2. Ingresa tus API keys
3. Selecciona el idioma destino
4. ¡Listo! Visita un sitio de manga y haz clic en "Traducir"

## Uso

1. Navega a un sitio de manga (ej: MangaDex)
2. Haz clic en el ícono de la extensión
3. Selecciona **Modo Auto** (traduce todas las imágenes) o **Modo Clic** (selecciona región)
4. Los overlays aparecerán sobre el texto traducido
5. Puedes arrastrar, editar o fusionar overlays

## Tecnologías

- JavaScript vanilla (sin frameworks)
- Chrome Extension Manifest V3
- OCR.space API
- DeepL API
- chrome.storage API

## Licencia

MIT