# Итоговый отчет: Предобработка данных ЭЭГ, МЭГ и фМРТ: Артефакты, Фильтрация и Нормализация

## Введение

Данный отчет посвящен предобработке данных электроэнцефалографии (ЭЭГ), магнитоэнцефалографии (МЭГ) и функциональной магнитно-резонансной томографии (фМРТ). Эти методы нейровизуализации широко используются для изучения активности мозга, но получаемые данные часто содержат шум и артефакты, которые могут искажать результаты исследований. Целью данного отчета является подробное рассмотрение этапов предобработки данных ЭЭГ, МЭГ и фМРТ, включая идентификацию и удаление артефактов, фильтрацию и нормализацию данных. Также будет рассмотрен потенциал применения генеративных моделей ИИ для улучшения качества предобработки и анализа данных.

## 1. Артефакты в данных ЭЭГ, МЭГ и фМРТ

Артефакты – это нежелательные сигналы, присутствующие в данных нейровизуализации, которые не связаны с нейронной активностью. Они могут быть вызваны различными факторами и существенно искажать результаты анализа.  Артефакты можно разделить на три основные категории:

### 1.1. Физиологические артефакты

Эти артефакты возникают из-за биологических процессов в организме пациента:

*   **Движения глаз:** Электроокулограмма (ЭОГ) регистрирует движения глаз, которые могут создавать значительные артефакты в ЭЭГ и МЭГ данных, особенно в лобных областях.  Моргание также является распространенным источником артефактов.
*   **Мышечная активность:** Электромиограмма (ЭМГ) регистрирует активность мышц. Сокращения мышц лица, шеи и головы могут создавать высокочастотные артефакты в ЭЭГ и МЭГ данных.
*   **Сердечная деятельность:** Электрокардиограмма (ЭКГ) регистрирует электрическую активность сердца.  Пульсовые волны и связанные с ними магнитные поля могут создавать артефакты в ЭЭГ и МЭГ данных, особенно в височных областях.
*   **Потоотделение:** Изменения проводимости кожи, связанные с потоотделением, могут создавать медленные колебания в ЭЭГ данных.
*   **Дыхание:** Движения грудной клетки и связанные с ними изменения электрического сопротивления могут влиять на ЭЭГ и МЭГ сигналы.

### 1.2. Технические артефакты

Эти артефакты связаны с оборудованием и процедурой записи:

*   **Плохой контакт электродов (для ЭЭГ):** Высокое сопротивление между электродом и кожей головы может приводить к появлению шума и искажению сигнала.
*   **Движение электродов или проводов (для ЭЭГ и МЭГ):**  Любые движения электродов или проводов могут создавать артефакты.
*   **Неисправность оборудования:**  Проблемы с усилителями, фильтрами или другими компонентами системы записи могут приводить к появлению артефактов.
*   **Артефакты, связанные с МРТ (для фМРТ):**  Движения головы пациента внутри сканера, неоднородность магнитного поля, артефакты, связанные с градиентами, и радиочастотные помехи могут создавать артефакты в фМРТ данных.

### 1.3. Внешние артефакты

Эти артефакты связаны с окружающей средой:

*   **Электромагнитные помехи:**  Линии электропередач, электронные устройства и другие источники электромагнитного излучения могут создавать помехи в ЭЭГ и МЭГ данных.
*   **Вибрации:**  Вибрации здания или оборудования могут влиять на МЭГ сигналы.

## 2. Методы удаления артефактов

Существует несколько методов удаления артефактов из данных ЭЭГ, МЭГ и фМРТ. Выбор метода зависит от типа артефакта и характеристик данных.

### 2.1. Визуальный осмотр

Опытный исследователь может идентифицировать многие артефакты путем визуального осмотра данных.  Этот метод является субъективным и трудоемким, но может быть полезен для выявления грубых артефактов.

### 2.2. Регрессия

Метод регрессии используется для удаления артефактов, которые коррелируют с известными сигналами, такими как ЭОГ или ЭКГ.  Сигналы ЭОГ и ЭКГ регистрируются одновременно с ЭЭГ или МЭГ, и затем используются для построения регрессионной модели, которая позволяет удалить из основного сигнала компоненты, связанные с артефактами.

### 2.3. Независимый компонентный анализ (ICA)

ICA – это метод разделения смеси сигналов на независимые компоненты.  Он часто используется для удаления артефактов из ЭЭГ и МЭГ данных.  ICA предполагает, что артефакты являются статистически независимыми от нейронной активности и друг от друга.  После разделения компонентов артефактные компоненты могут быть идентифицированы и удалены, а затем данные могут быть реконструированы без артефактов.

### 2.4. Анализ главных компонент (PCA)

PCA – это метод уменьшения размерности данных, который может быть использован для удаления шума и артефактов.  PCA идентифицирует главные компоненты данных, которые объясняют наибольшую дисперсию.  Компоненты, связанные с шумом и артефактами, обычно имеют меньшую дисперсию и могут быть удалены.

### 2.5. Вейвлет-преобразование

Вейвлет-преобразование – это метод разложения сигнала на различные частотные компоненты.  Он может быть использован для удаления артефактов, которые имеют специфические частотные характеристики.  Например, высокочастотные артефакты, связанные с мышечной активностью, могут быть удалены с помощью вейвлет-фильтрации.

### 2.6. Фильтрация на основе машинного обучения

Методы машинного обучения, такие как искусственные нейронные сети, могут быть обучены для идентификации и удаления артефактов из данных ЭЭГ, МЭГ и фМРТ.  Эти методы могут быть особенно эффективны для удаления сложных и нелинейных артефактов.

### 2.7. Специфичные для фМРТ методы

Для фМРТ данных используются дополнительные методы удаления артефактов, такие как коррекция движения, коррекция искажений, связанных с неоднородностью магнитного поля, и удаление физиологического шума.

## 3. Фильтрация данных

Фильтрация – это процесс удаления нежелательных частотных компонентов из сигнала.  В контексте предобработки данных ЭЭГ, МЭГ и фМРТ фильтрация используется для улучшения соотношения сигнал/шум и удаления артефактов, которые имеют специфические частотные характеристики.

### 3.1. Типы фильтров

*   **Фильтры нижних частот (ФНЧ):**  Пропускают низкие частоты и подавляют высокие.  Используются для удаления высокочастотного шума и мышечных артефактов.
*   **Фильтры верхних частот (ФВЧ):**  Пропускают высокие частоты и подавляют низкие.  Используются для удаления медленных колебаний, связанных с дрейфом базовой линии и потоотделением.
*   **Полосовые фильтры:**  Пропускают определенный диапазон частот и подавляют частоты за пределами этого диапазона.  Используются для выделения определенных ритмов мозга, таких как альфа-ритм (8-12 Гц).
*   **Режекторные фильтры:**  Подавляют определенный диапазон частот и пропускают частоты за пределами этого диапазона.  Используются для удаления линейного шума (50 или 60 Гц).

### 3.2. Параметры фильтров

*   **Частота среза:**  Частота, на которой фильтр начинает подавлять сигнал.
*   **Порядок фильтра:**  Определяет крутизну спада АЧХ фильтра.  Более высокий порядок обеспечивает более крутой спад, но может приводить к фазовым искажениям.
*   **Тип фильтра:**  Существуют различные типы фильтров, такие как фильтры Баттерворта, Чебышева и эллиптические фильтры, которые имеют разные характеристики.

## 4. Нормализация данных

Нормализация – это процесс приведения данных к общему виду для последующего анализа и сравнения.  Это особенно важно при анализе данных, полученных от разных испытуемых или в разных сеансах записи.

### 4.1. Методы нормализации

*   **Z-преобразование:**  Каждое значение данных вычитается из среднего значения и делится на стандартное отклонение.  Это приводит к тому, что данные имеют среднее значение 0 и стандартное отклонение 1.
*   **Нормализация по базовой линии:**  Из каждого значения данных вычитается среднее значение сигнала в течение определенного периода времени, который считается базовой линией (например, период перед началом стимула).
*   **Нормализация по амплитуде:**  Данные масштабируются таким образом, чтобы максимальное значение было равно 1, а минимальное значение было равно 0.
*   **Пространственная нормализация (для фМРТ):**  Данные фМРТ трансформируются в стандартное пространство мозга, такое как пространство Талайраха или MNI, для обеспечения возможности сравнения данных между испытуемыми.

## 5. Генеративные модели ИИ для предобработки и анализа данных ЭЭГ, МЭГ и фМРТ

Генеративные модели ИИ, такие как генеративно-состязательные сети (GAN), вариационные автокодировщики (VAE), трансформеры и диффузионные модели, изначально разрабатывались для обработки текста, изображений, аудио и видео, но могут быть адаптированы для других типов данных, включая данные мозговой активности. Эти модели обладают потенциалом для улучшения качества предобработки и анализа данных ЭЭГ, МЭГ и фМРТ.

### 5.1. Применение генеративных моделей

*   **Удаление артефактов:** GAN могут быть обучены для генерации 

## Источники

- https://www.resonatehq.com/ru/ultimate-guide-to-generative-ai-for-non-developers
- https://www.unite.ai/ru/%D0%B3%D0%B5%D0%BD%D0%B5%D1%80%D0%B0%D1%82%D0%B8%D0%B2%D0%BD%D1%8B%D0%B9-%D0%98%D0%98-%E2%80%94-%D0%B8%D0%B4%D0%B5%D1%8F-chatgpt-dall-e-midjourney-%D0%B8-%D0%BC%D0%BD%D0%BE%D0%B3%D0%BE%D0%B5-%D0%B4%D1%80%D1%83%D0%B3%D0%BE%D0%B5/
- https://smodin.io/blog/ru/how-does-generative-ai-work/
- https://www.tadviser.ru/index.php/%D0%A1%D1%82%D0%B0%D1%82%D1%8C%D1%8F:%D0%93%D0%B5%D0%BD%D0%B5%D1%80%D0%B0%D1%82%D0%B8%D0%B2%D0%BD%D1%8B%D0%B9_%D0%B8%D1%81%D0%BA%D1%83%D1%81%D1%81%D1%82%D0%B2%D0%B5%D0%BD%D0%BD%D1%8B%D0%B9_%D0%B8%D0%BD%D1%82%D0%B5%D0%BB%D0%BB%D0%B5%D0%BA%D1%82
- https://www.progkids.com/blog/python-v-nejronauke-10-primenenij
- https://cmi.to/%D0%B0%D1%80%D1%82%D0%B5%D1%84%D0%B0%D0%BA%D1%82%D1%8B/
- https://krascpk.ru/images/files/%D0%9B%D0%B5%D0%BA%D1%86%D0%B8%D1%8F%201_%20%D0%AD%D0%BB%D0%B5%D0%BA%D1%82%D1%80%D0%BE%D1%8D%D0%BD%D1%86%D0%B5%D1%84%D0%B0%D0%BB%D0%BE%D0%B3%D1%80%D0%B0%D1%84%D0%B8%D1%8F.pdf
- http://eeg-online.ru/cl_eeghome.htm
- https://medicom-mtd.com/htm/Pub/pub_eeg_273.pdf
- https://dzen.ru/a/YL-K2pmPvVJeNskN