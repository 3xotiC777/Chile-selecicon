# Selección de campo · Chile

Aplicación para preparar la selección semanal de auditorías y compartir el seguimiento de campo. Lee la hoja RETAIL del planning, cruza las frecuencias del universo y cuenta visitas TERMINADO del export. Genera un ZIP con un CSV por estudio y un solo `SOVI EMBONOR.csv` con los ocho SOVI.

**Portal compartido:** https://chile-seleccion.vercel.app/

**Selección local:** https://3xotiC777.github.io/Chile-selecicon/

## Seguimiento y acceso

El portal de Vercel usa Supabase Auth. El primer administrador se crea mediante un enlace privado de activación de un solo uso, con token aleatorio cuyo hash y vencimiento están en un esquema privado. No hay registro público. El administrador crea y elimina usuarios en **Usuarios**; campo solo consulta y descarga. Cada usuario puede cambiar su contraseña.

**Avance de campo** ofrece filtros por cliente, estudio, auditor, región, estado y puntos programados; avance mensual por estudio, detalle de pendientes, VACIO, RECHAZADO y mediciones SOVI incompletas. **Productividad** usa el auditor que realizó la encuesta y divide encuestas entre días con actividad registrados en el export. El tiempo promedio usa solo duraciones válidas y se pondera por encuestas. Los VACIO sin fecha se muestran como pendientes del export; no aportan visitas cumplidas ni días de productividad. Precios y fotografías CENCOSUD tienen metas mensuales independientes.

Las tarjetas y el avance por estudio muestran el mes completo para cliente, estudio, auditor y región elegidos. Estado, búsqueda y **Solo programados** filtran únicamente el detalle de puntos, que indica cuántos registros muestra del total mensual. **Ver todos los puntos del mes** limpia esos tres filtros y conserva los demás. La productividad usa cliente, estudio y auditor del export; no cambia con la región ni con los filtros del detalle.

La gráfica **Avance por semana** muestra las mediciones que cada semana aportó a la meta del mes y responde a los mismos filtros del resumen mensual. Las semanas van de lunes a domingo, recortadas al rango operativo confirmado; los días de septiembre que pertenecen a octubre aparecen en su semana 1. Una medición SOVI requiere los ocho estudios completos. Las visitas repetidas que superan la cuota o repiten una quincena cumplida no agregan avance a las barras. Las semanas posteriores a la última fecha del export se distinguen como sin registros.

Los encabezados de las tablas de auditores y puntos permiten ordenar cualquier columna: un clic ascendente y otro descendente, con una flecha que indica el orden activo. Los puntos se ordenan antes de paginar. Las descargas de avance y productividad conservan los filtros y el orden de su tabla; los valores sin dato se muestran al final en ambos sentidos.

La carga de **Actualizar seguimiento** reemplaza únicamente el export. Las planeaciones semanales se conservan y cualquier usuario puede volver a descargar sus ZIP. **Base de seguimiento** permite cargar RETAIL y universo sin generar una selección. En **Planeación**, generar y revisar los CSV y pulsar **Guardar planeación compartida** para registrar la programación de esa semana. Guardar una selección no confirma ejecución: solo TERMINADO del export cumple la meta.

La base guarda solo el mes operativo activo: un planning normalizado, un universo, el último export y hasta cinco selecciones semanales. Al guardar un nuevo mes se reemplazan los datos anteriores y se borran sus selecciones dentro de la misma transacción. Descargar los históricos necesarios antes de cambiar de mes. No se acumulan Excel originales, export anteriores ni ZIP binarios; los ZIP se regeneran con las mismas filas guardadas. El límite de datos mensuales es 25 MB y el de cada selección, 10 MB. El dashboard revisa cambios al volver a la pestaña y cada minuto mientras está visible; consulta primero solo la revisión y descarga los datos completos únicamente si cambiaron, para reducir transferencia en el plan gratuito. Los registros fechados fuera del mes operativo no se guardan.

RLS está habilitado en todas las tablas de la aplicación. Las consultas requieren una cuenta con membresía; las escrituras requieren rol administrador. Los usuarios no pueden modificar su membresía ni elevar su rol. La gestión de usuarios verifica el JWT y la membresía actual en una Edge Function; su clave de servicio permanece únicamente en Supabase. Retirar la membresía bloquea también las consultas con tokens anteriores. La revisión optimista evita que dos cargas simultáneas sobrescriban cambios sin avisar. CSP restringe los scripts y las conexiones del portal, y se impide incrustarlo en otros sitios.

## Uso

1. Elegir el mes y confirmar **Fechas del mes operativo** la primera vez. Por ejemplo, octubre de 2026 va del **28/09/2026 al 31/10/2026**. Se recuerda por mes en este navegador y, si ya es el mes activo compartido, se guarda para todo el equipo. **Cambiar rango** permite corregirlo; si se amplían las fechas compartidas, volver a subir el export completo para recuperar registros que quedaban fuera. Después elegir la semana y el total de semanas operativas, y cargar la planeación `.xlsm` o `.xlsx`. La carga respeta el período elegido, incluso si se cambia mientras se lee el archivo. Si aún no se ha elegido un período, la página sugiere uno a partir de las fechas de RETAIL. Si una semana cruza dos meses, elegir el mes y la semana de la operación; el nombre del archivo no determina ese período.
2. Cargar el export de visitas. Es opcional en semana 1 y obligatorio desde semana 2.
3. Cargar `UNIVERSO CHILE.xlsx` la primera vez. Se recuerda localmente y se puede reemplazar u olvidar.
4. Elegir semana normal, un feriado o dos feriados.
5. Si un código de auditor es incorrecto, usar **Correcciones de auditor** con `FOLIO=CODIGO`. Se aplica en todos los estudios, se muestra en el resumen y se recuerda en ese navegador. Las exclusiones manuales son independientes y se borran al recargar.
6. Generar, revisar las observaciones y la carga por auditor, y descargar el ZIP. El detalle con motivos y el resumen de carga se pueden descargar por separado.
7. Usar **Descargar planning con selección** para guardar una copia del Excel cargado, con una columna **SELECCIONADO** en la fila 7 de RETAIL. Cada folio de la tabla lleva **SÍ** si aparece en al menos uno de los CSV generados, o **NO** si no aparece en ninguno, incluidas las exclusiones manuales y los puntos sin estudios habilitados. La columna se agrega junto a los encabezados existentes, sin pisar datos. Si ya existe SELECCIONADO, se actualiza. Cambiar archivos o ajustes invalida la copia y obliga a generar de nuevo.

El planning anotado conserva la extensión `.xlsm` o `.xlsx`, todas las hojas y sus estados, las fórmulas, los formatos, las macros y los demás componentes del archivo original. Solo se modifica el XML de RETAIL para agregar las marcas y ajustar el ancho de esa columna. Las fechas originales del planning se conservan, incluso cuando se usan otras fechas para los CSV. El original no se sobrescribe y no se ejecutan macros. La copia se descarga por separado; el ZIP mantiene exclusivamente los CSV de carga.

Si un planning copiado conserva fechas antiguas, corregir las filas 2 y 3 de RETAIL o activar **Usar otras fechas de carga** e indicar inicio y fin. La corrección explícita se aplica a todos los CSV, al corte del export y al cálculo de las quincenas; se muestra en las observaciones y no modifica el Excel. Debe abarcar como máximo siete días e incluir el mes seleccionado. Se desactiva al subir otro planning para evitar arrastrar fechas de un archivo anterior.

Ejemplo: para octubre de 2026, semana operativa 1, del **28/09/2026 al 03/10/2026**, seleccionar **octubre / semana 1**. El export sigue siendo opcional. Si RETAIL todavía dice 21/09–26/09, hay que corregir las fechas del Excel o indicarlas en la página antes de generar; cambiar solamente el nombre del archivo no cambia sus fechas.

Los archivos se leen en un Web Worker en el navegador. En Vercel, las cargas de seguimiento y el botón de guardar selección envían a Supabase sus datos normalizados para compartirlos; generar una selección local no la guarda automáticamente. El universo y las correcciones también pueden recordarse en el navegador. El repositorio y GitHub Pages contienen solamente código, nunca archivos operativos. No se ejecutan macros ni se modifican los Excel originales. Las fórmulas del planning se leen a partir de los valores guardados por Excel: recalcular y guardar el archivo antes de cargarlo si hubo cambios.

## Reglas implementadas

La página lee los bytes al seleccionar cada archivo y reutiliza esa copia en memoria al generar. Espera a que la planeación muestre sus fechas y el estado indique «Archivos listos». Si no se puede leer un archivo sincronizado, el mensaje identifica cuál: marca **Mantener siempre en este dispositivo**, espera a la descarga y vuelve a seleccionarlo; también puedes usar una copia en Descargas. Si editas el Excel después de cargarlo, vuelve a seleccionarlo para usar la nueva versión.

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
| PRECIOS COLGATE y COLGATE PROMOCIONES FARMACIAS | Quincenales, una visita TERMINADO por quincena en cada estudio. Semanas 1 y 3: mitad por auditor, redondeada hacia arriba; en semana 3 se prioriza la otra mitad cuando empatan las visitas. Semanas 2 y 4: todos los pendientes de esa quincena, incluidas visitas vacías o rechazadas. Semana 5: solo pendientes de la segunda, sin una tercera medición. |
| EXHIBICIONES COLGATE | Mensual: solo puntos con cero TERMINADO en ese estudio dentro del rango del mes. |
| CENCOSUD | Una visita mensual de precios y una de fotografías. El folio deja de seleccionarse cuando ambos estudios tienen TERMINADO; también se acepta el estudio genérico CENCOSUD legado. Nombre genérico configurable. El CSV conserva su código original. |
| POY y FERIAS LIBRES | Carga completa. |

El conteo usa `DIA` dentro del rango mensual confirmado, con ambos extremos incluidos. La selección toma solo visitas anteriores al inicio de la carga semanal; el dashboard puede mostrar todo el avance registrado dentro del rango. La semana de carga debe quedar dentro de esas fechas. Los datos anteriores sin un rango confirmado conservan el cálculo por lunes de la carga menos `(semana elegida − 1) × 7 días`. Para octubre de 2026, semana 2, con carga 05/10–10/10, se cuentan las visitas desde **28/09** y anteriores al **05/10**. Las visitas del 28–30 de septiembre participan en las cuotas mensuales y quincenales de octubre. Los ocho componentes SOVI del 28/09–04/10 se pueden completar a ambos lados del cambio de mes.

`DIA SINCRO` no determina la semana. Para SOVI solo cuentan semanas previas a la semana de inicio del planning. Una semana aporta como máximo una visita SOVI, aunque un componente tenga encuestas repetidas. Los registros repetidos con el mismo ID de VISITA, estudio y folio se cuentan una vez; si no hay ID se deduplica por estudio, folio y día.

Las semanas 1–2 forman la primera quincena operativa; 3–5 forman la segunda. Con un rango confirmado, la segunda comienza 14 días después del lunes de su fecha inicial. Sin un rango confirmado, se conserva el cálculo desde el lunes del planning y el número de semana elegido: lunes del planning + `(3 − semana) × 7 días`. En septiembre de 2026, con el 21 de septiembre como semana 4, la segunda quincena comienza el lunes 14. No se corta automáticamente por el día 15 del calendario.

Una selección no cuenta como visita: solo el export TERMINADO confirma la medición. En la semana de cierre se incluyen todos los pendientes, no se vuelve a tomar la mitad de los pendientes. Un punto completado en la quincena se excluye de nuevas selecciones aunque tenga menos de dos visitas mensuales. Si ya lleva dos, nunca se genera una tercera. El detalle muestra los conteos de cada quincena por separado.

Se advierte si no hubo medición en la primera quincena, si hay mediciones históricas repetidas dentro de una misma quincena o si un pendiente SOVI no está seleccionado en OSA. El sistema no puede garantizar la ejecución en campo ni recuperar una quincena pasada duplicando visitas en la siguiente. Se conserva siempre la dependencia con OSA.

Las fijas OSA siempre se programan en semana normal, aunque hayan alcanzado cuatro visitas: su objetivo es una por semana de campo. La reducción por feriado afecta solo a fijas OSA y se propaga a estudios dependientes por su selección. El reparto quincenal de SOVI, OSA quincenal, Cruz Verde frecuencia 2, PRECIOS COLGATE y COLGATE PROMOCIONES FARMACIAS se calcula por auditor.

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

`src/tracking.js` calcula metas y productividad; `src/dashboard.js` muestra filtros y descargas; `src/portal.js` integra acceso y cargas; `src/cloud.js` usa exclusivamente la clave publicable. Copiar `.env.example` a `.env.local` y configurar `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` para habilitar el portal. Nunca usar una clave de servicio con prefijo `VITE_`.

El esquema de Supabase está en `supabase/schema.sql`; `supabase/verify-access.sql` valida permisos, concurrencia y reemplazo de mes dentro de una transacción que se revierte. La Edge Function está en `supabase/functions/chile-access/index.ts` y valida JWT explícitamente dentro del handler para permitir la activación inicial sin sesión. Aplicar el esquema, después las migraciones de `supabase/migrations` en orden, y desplegar la función antes de conectar un proyecto nuevo. En Authentication, desactivar el registro público y los accesos anónimos, establecer mínimo 12 caracteres y activar Secure password change. La gestión de cuentas usa las variables internas de Supabase; la sincronización SQL usa variables privadas de Vercel. `vercel.json` define el build y los encabezados de seguridad. Al cambiar de proyecto, actualizar también el dominio de Supabase permitido en CSP.

## Seguimiento automático desde SQL Server

En Vercel, `/api/sync-report` consulta SQL Server con parámetros de fecha: inicio incluido y día posterior al fin excluido. Usa el **rango operativo del mes activo**, por ejemplo 28/09–31/10 para octubre, y conserva todas las encuestas de ese rango. Los estados confirmados son 4 = TERMINADO, 5 = RECHAZO, 1 y 2 = VACIO; otros códigos no suman avance. La productividad conserva el auditor real, hora de inicio, fin y duración. Una encuesta VACIO de SQL sin inicio ni fin queda visible en puntos, pero no inventa un día trabajado ni una última visita.

La sincronización diaria está programada a las 11:00 UTC (por la mañana en Chile). En Vercel Hobby la ejecución puede ocurrir durante esa hora. El administrador puede pulsar **Actualizar seguimiento → Sincronizar ahora**. La pantalla muestra última sincronización, cantidad de registros y fallos; campo consulta automáticamente cambios cada minuto mientras la página esté visible. Las cargas manuales siguen disponibles y la próxima sincronización las reemplaza por la información de SQL.

La planeación usa el avance compartido cuando no se carga un export, solo si pertenece al mes elegido y cubre todo su rango. En otro mes o al ampliar fechas aún no sincronizadas, exige el export desde semana 2. Cambiar los datos compartidos invalida una selección calculada con una versión anterior. Los ZIP ya guardados se conservan.

Configurar en Vercel como variables sensibles de servidor: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `CRON_SECRET`, `SQLSERVER_HOST`, `SQLSERVER_DATABASE`, `SQLSERVER_PORT`, `SQLSERVER_USER`, `SQLSERVER_PASSWORD`. Para un certificado privado, configurar además `SQLSERVER_CA_PEM` y `SQLSERVER_CERT_NAME`. Nunca usar prefijo `VITE_`. La conexión siempre cifra y valida el certificado; un certificado reemplazado requiere actualizar la confianza. Usar un usuario SQL de lectura y mantener estas variables fuera de previews de terceros.

Solo el cron con secreto fuerte o un administrador con JWT verificado y membresía vigente pueden iniciar la actualización. Las RPC son `SECURITY INVOKER`, con ejecución exclusiva de `service_role`. `chile_sql_sync` tiene RLS y una única fila de estado, legible por miembros y editable únicamente por el servidor. Una reserva de cinco minutos evita lecturas simultáneas y se aplica un intervalo mínimo de un minuto. El guardado compara el mes y la revisión originales: si cambió la base, las fechas o el export, descarta la lectura y conserva los datos actuales. Errores, respuestas inválidas, límites o una respuesta súbitamente vacía tampoco borran el avance. Se conserva solo el mes activo, su último snapshot y sus ZIP; no se acumula historial de SQL.

GitHub Actions valida las pruebas, construye con Vite y publica `dist` en GitHub Pages en cada cambio a `main`. Rutas relativas permiten alojar bajo `/Chile-selecicon/`. Configurar Pages con origen **GitHub Actions**.

Dependencias: [SheetJS CE](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/) para lectura, [fflate](https://github.com/101arrowz/fflate) para ZIP, Vite para compilación. La configuración de publicación sigue la [documentación de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
