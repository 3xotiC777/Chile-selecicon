# Selección de campo · Chile

Aplicación estática para preparar la selección semanal de auditorías. Lee la hoja RETAIL del planning, cruza las frecuencias del universo y cuenta visitas TERMINADO del export. Genera un ZIP con un CSV por estudio y un solo `SOVI EMBONOR.csv` con los ocho SOVI.

**Página:** https://3xotiC777.github.io/Chile-selecicon/

## Uso

1. Elegir el mes, la semana y el total de semanas operativas, y cargar la planeación `.xlsm` o `.xlsx`. La carga respeta el período elegido, incluso si se cambia mientras se lee el archivo. Si aún no se ha elegido un período, la página sugiere uno a partir de las fechas de RETAIL. Si una semana cruza dos meses, elegir el mes y la semana de la operación; el nombre del archivo no determina ese período.
2. Cargar el export de visitas. Es opcional en semana 1 y obligatorio desde semana 2.
3. Cargar `UNIVERSO CHILE.xlsx` la primera vez. Se recuerda localmente y se puede reemplazar u olvidar.
4. Elegir semana normal, un feriado o dos feriados.
5. Si un código de auditor es incorrecto, usar **Correcciones de auditor** con `FOLIO=CODIGO`. Se aplica en todos los estudios, se muestra en el resumen y se recuerda en ese navegador. Las exclusiones manuales son independientes y se borran al recargar.
6. Generar, revisar las observaciones y la carga por auditor, y descargar el ZIP. El detalle con motivos y el resumen de carga se pueden descargar por separado.

Si un planning copiado conserva fechas antiguas, corregir las filas 2 y 3 de RETAIL o activar **Usar otras fechas de carga** e indicar inicio y fin. La corrección explícita se aplica a todos los CSV, al corte del export y al cálculo de las quincenas; se muestra en las observaciones y no modifica el Excel. Debe abarcar como máximo siete días e incluir el mes seleccionado. Se desactiva al subir otro planning para evitar arrastrar fechas de un archivo anterior.

Ejemplo: para octubre de 2026, semana operativa 1, del **28/09/2026 al 03/10/2026**, seleccionar **octubre / semana 1**. El export sigue siendo opcional. Si RETAIL todavía dice 21/09–26/09, hay que corregir las fechas del Excel o indicarlas en la página antes de generar; cambiar solamente el nombre del archivo no cambia sus fechas.

Los archivos se procesan en un Web Worker en el navegador, sin subir datos a un servidor. El universo y las correcciones se guardan en almacenamiento local; el planning y el export permanecen en memoria. El repositorio y GitHub Pages contienen solamente código, nunca archivos operativos. No se ejecutan macros ni se modifican los Excel originales. Las fórmulas del planning se leen a partir de los valores guardados por Excel: recalcular y guardar el archivo antes de cargarlo si hubo cambios.

## Reglas implementadas

| Grupo | Selección |
| --- | --- |
| OSA BEBESTIBLES fija | Todas cada semana. Con feriados: `round(N × (1 − 0.17 × feriados))`, sobre el total de folios fijos habilitados. Se prioriza menor cantidad de TERMINADO; en empate, el auditor con menos puntos seleccionados contando los otros estudios. |
| OSA quincenal | Una medición por quincena, máximo dos mensuales. Semanas 1 y 3: mitad por auditor, redondeada hacia arriba. Semanas 2 y 4: todos los pendientes de esa quincena. Semana 5: pendientes de la segunda, sin repetir los completados. No se reduce por feriado. |
| Equipos de frío, OSA ABI, OSA vinos y ambas exhibiciones Embonor | Exactamente los mismos folios de OSA. Si falta uno habilitado, se detiene la generación para corregir el planning. |
| SOVI | Solo folios de OSA habilitados en los ocho estudios. Una visita válida requiere los ocho estudios distintos TERMINADO en la misma semana de lunes a domingo. Pueden ser días distintos. Se suman todas las semanas completas transcurridas del mes. No se combinan estudios de semanas diferentes. |
| SOVI quincenal | Una medición por quincena, máximo dos al mes. Comparte el reparto de OSA y su dependencia: no se vuelve a partir a la mitad el subconjunto quincenal ya seleccionado por OSA. Solo participan los puntos habilitados en los ocho estudios. |
| SOVI fija | Una medición por quincena, máximo dos al mes. Semanas 1 y 3: mitad de elegibles OSA por auditor, redondeada hacia arriba; prioridad por menos visitas completas. Semanas 2 y 4: todos los pendientes, incluso si superan la mitad por visitas fallidas. Semana 5: solo pendientes de la segunda quincena. Los ocho estudios replican los mismos folios. |
| Facing ABI | Visitas de FACING CERVEZAS 2. Una al mes para todos los puntos: requiere OSA y cero visitas, sin SOVI. En la última semana declarada se permite coincidir con SOVI. Si queda un pendiente sin OSA, se informa sin romper esa dependencia. |
| Cruz Verde | Cada estudio por separado. Frecuencia 2: una medición por quincena con el mismo reparto por mitades que OSA quincenal. Frecuencias 3 y 4: se asigna si faltan visitas para la cuota mensual. CRUZ VERDE PROFUNDIDAD corresponde a CV TEST en el export. |
| Colgate | PRECIOS COLGATE, EXHIBICIONES COLGATE y COLGATE PROMOCIONES FARMACIAS: solo cero TERMINADO en su propio estudio del mes. |
| CENCOSUD | Una visita mensual. Seleccionar solo puntos sin TERMINADO de CENCOSUD en el mes. Nombre del export configurable. |
| POY y FERIAS LIBRES | Carga completa. |

El conteo se filtra por `DIA` de la visita, mes elegido y fecha anterior al inicio del planning. `DIA SINCRO` no determina la semana. Para SOVI solo cuentan semanas previas a la semana de inicio del planning. Una semana aporta como máximo una visita SOVI, aunque un componente tenga encuestas repetidas. Los registros repetidos con el mismo ID de VISITA, estudio y folio se cuentan una vez; si no hay ID se deduplica por estudio, folio y día.

Las semanas 1–2 forman la primera quincena operativa; 3–5 forman la segunda. La fecha de inicio de la segunda se calcula desde el lunes del planning y el número de semana elegido: lunes del planning + `(3 − semana) × 7 días`. En septiembre de 2026, con el 21 de septiembre como semana 4, la segunda quincena comienza el lunes 14. No se corta automáticamente por el día 15 del calendario. Los conteos siguen limitados al mes elegido.

Una selección no cuenta como visita: solo el export TERMINADO confirma la medición. En la semana de cierre se incluyen todos los pendientes, no se vuelve a tomar la mitad de los pendientes. Un punto completado en la quincena se excluye de nuevas selecciones aunque tenga menos de dos visitas mensuales. Si ya lleva dos, nunca se genera una tercera. El detalle muestra los conteos de cada quincena por separado.

Se advierte si no hubo medición en la primera quincena, si hay mediciones históricas repetidas dentro de una misma quincena o si un pendiente SOVI no está seleccionado en OSA. El sistema no puede garantizar la ejecución en campo ni recuperar una quincena pasada duplicando visitas en la siguiente. Se conserva siempre la dependencia con OSA.

Las fijas OSA siempre se programan en semana normal, aunque hayan alcanzado cuatro visitas: su objetivo es una por semana de campo. La reducción por feriado afecta solo a fijas OSA y se propaga a estudios dependientes por su selección. El reparto quincenal de SOVI, OSA quincenal y Cruz Verde frecuencia 2 se calcula por auditor.

### Equilibrio de carga

Se conserva el auditor de cada folio del planning (incluidas las correcciones explícitas). No se trasladan puntos entre rutas. Las frecuencias, los pendientes de cierre, las mitades por auditor y los cruces entre estudios tienen prioridad sobre el equilibrio.

La selección de fijas con feriado cuenta primero los puntos comprometidos por Cruz Verde, Colgate, Cencosud, POY, FERIAS LIBRES y OSA quincenal. Entre fijas con igual número de visitas válidas, el siguiente punto se toma del auditor con menos puntos únicos seleccionados. La carga se actualiza con cada elección. Si también empata la carga, se favorece al que lleva menos fijas de esta muestra; los últimos desempates son código de auditor y folio ascendentes. Se conserva exactamente la muestra global calculada por feriado y se agotan los candidatos disponibles sin inventar puntos.

El resumen **Carga de trabajo por auditor** muestra la base del planning, los puntos únicos seleccionados, todas las encuestas (filas CSV) y los puntos OSA, SOVI, Facing y Cruz Verde. Incluye auditores con cero seleccionados y se ordena de mayor a menor carga. Los ocho estudios SOVI son un punto de campo y ocho encuestas. El resumen tiene descarga independiente y no se agrega al ZIP de carga.

Este equilibrio mejora la elección cuando existe margen dentro de las reglas. No garantiza la misma cantidad para todas las rutas: por ejemplo, en una semana normal hay que asignar todas las fijas, y en el cierre todos los pendientes quincenales, aunque un auditor tenga más puntos en su planning.

## Formatos

- Planning: `RETAIL`, folios B desde fila 8, auditor P, nombre Q, códigos de estudio fila 6, nombres fila 7, fecha inicial fila 2 y final fila 3. Estudios hasta la columna TOTAL, celdas con valor 1. La lectura termina en el primer folio vacío o cero, como la macro original.
- Universo: `FOLIO CADEM` (o `FOLIO`), `FRECUENCIA`, `CLIENTE`. El cruce incluye cliente y folio.
- Export: `FOLIO`, `ESTUDIO`, `ESTADO`, `DIA`; `VISITA` se usa para deduplicar si existe. Se aceptan `.xlsx`, `.xlsm` y `.csv`.
- Salida: `FOLIO;COD_AUDITOR;COD_ESTUDIO;FECHA_INICIO;FECHA_DESDE;FECHA_FIN`, **sin encabezados**. UTF-8 sin BOM, separador punto y coma, fechas `dd/mm/aaaa`, finales CRLF. FECHA_INICIO y FECHA_DESDE usan fila 2 del estudio. Los estudios sin seleccionados generan archivos vacíos. El ZIP no contiene el detalle de revisión.

Errores de estructura, códigos inválidos, frecuencias ausentes o contradictorias, duplicados en RETAIL, estudios desconocidos y réplicas incompletas detienen la generación. Los nombres de los estudios del export son configurables en la página. La falta total de registros para un nombre se advierte, pues puede significar cero visitas o un export incompleto.

## Desarrollo y despliegue

Node.js 24 y npm:

```sh
npm ci
npm test
npm run dev
npm run build
```

`src/engine.js` contiene reglas puras; `src/workbooks.js` lee los archivos; `src/worker.js` procesa y empaqueta; `src/main.js` controla la interfaz. Las pruebas usan ejemplos sintéticos y verifican cuotas, semanas, dependencias, errores de origen y formato CSV.

GitHub Actions valida las pruebas, construye con Vite y publica `dist` en GitHub Pages en cada cambio a `main`. Rutas relativas permiten alojar bajo `/Chile-selecicon/`. Configurar Pages con origen **GitHub Actions**.

Dependencias: [SheetJS CE](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) para lectura, [fflate](https://github.com/101arrowz/fflate) para ZIP, Vite para compilación. La configuración de publicación sigue la [documentación de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
