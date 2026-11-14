# Patrimoni

Primera fase d’una PWA personal de gestió patrimonial. La interfície i les dades s’executen al navegador: IndexedDB és la base de dades local i el service worker desa els fitxers estàtics per permetre l’ús sense connexió després de la primera visita en una adreça HTTPS. No hi ha API, servidor de dades ni connexions bancàries.

## Arquitectura

- **Interfície:** HTML, CSS i JavaScript natius, sense pas de compilació ni dependències externes. Compatible amb Windows i navegadors mòbils.
- **Persistència:** IndexedDB amb magatzems separats per titulars, entitats, productes, valoracions, moviments i traspassos. L’esquema té versió per poder incorporar noves entitats en fases posteriors.
- **PWA/offline:** manifest i service worker amb memòria cau dels recursos locals. El service worker requereix HTTPS o `localhost`.
- **Còpies:** exportació i importació JSON des del dispositiu. La importació reemplaça les dades del navegador.
- **Publicació gratuïta:** es pot publicar aquesta carpeta a GitHub Pages o a un altre allotjament estàtic HTTPS gratuït. No cal mantenir un servidor.

## Primera fase inclosa

- Crear i editar titulars i entitats financeres; evitar-ne l’eliminació si tenen productes vinculats.
- Crear i editar productes, assignar titular, entitat, tipus, moneda i data d’alta; arxivar-los.
- Tipus de producte que inclouen pla d’estalvi i assegurança d’estalvi; monedes EUR, USD, GBP, CHF, CAD, AUD i JPY.
- Identificadors opcionals de compte bancari, compte de valors, pòlissa i altres; es desen al registre del producte i s’inclouen a les còpies JSON.
- Afegir valoracions datades, conservar-ne l’històric i corregir registres anteriors; registrar aportacions/retirades separadament i traspassos interns vinculats.
- Veure el valor més recent per producte, total patrimonial i filtre per titular.
- Importar/exportar còpies i carregar dades d’exemple explícitament fictícies.

El total agrega el darrer valor registrat de cada producte actiu. És una fotografia patrimonial; encara no calcula guanys ni rendibilitats. Les divises diferents es mostren en la seva moneda, però no es converteixen a una moneda comuna.

## Desplegament i instal·lació a iPhone

1. Publica els fitxers d’aquesta carpeta a GitHub Pages, amb `index.html` a l’arrel publicada.
2. Obre l’URL HTTPS a Safari a l’iPhone i espera que es carregui una vegada amb connexió.
3. A Safari, toca **Compartir → Afegir a la pantalla d’inici**.

Les dades queden al navegador d’aquell dispositiu. Exporta còpies regularment; esborrar les dades del lloc o del navegador les pot eliminar. La primera càrrega necessita connexió; després, la interfície es pot obrir sense connexió.

## Següents fases possibles

1. Evolució per període i per producte, patrimoni per entitat i categoria.
2. Càlculs de rendibilitats acumulades, anualitzades i XIRR quan les dades ho permetin.
3. Validació més estricta de còpies, opcions d’exportació i millores d’accessibilitat/usabilitat.
## Fase 1 — preparació per a rendibilitats (sense càlcul XIRR)

L’esquema IndexedDB és la versió 3 i manté els cinc magatzems previs: owners, institutions, products, valuations i movements. La migració additiva incorpora un índex flowNature a moviments i el magatzem transfers; no buida ni reescriu dades existents. El producte continua referenciant un titular únic mitjançant ownerId. Les valoracions i moviments nous capturen també moneda i titular del moment.

- Les valoracions noves tenen valuationType: opening (valoració inicial) o snapshot (actualització posterior), a més de data, valor, moneda, titular i observacions. Una valoració és una fotografia del valor, no una entrada de capital.
- Els moviments nous conserven type (aportació/retirada), i afegeixen flowNature: external, moneda i titular. La direcció més la naturalesa permetrà construir fluxos amb signe per a XIRR.
- Els traspassos es guarden una sola vegada a transfers, amb producte d’origen/destinació, data, imports introduïts per a cada producte, monedes i titulars de cada costat. A nivell global s’exclouran com a capital extern; per rendibilitat de cada producte/titular es podran tractar com una sortida i una entrada vinculades. No es calcula cap canvi de moneda.
- Els moviments importats de JSON v1/v2 sense flowNature es conserven literalment i es mostren pendents de classificar. La classificació externa és una acció manual; si un moviment antic era un traspàs intern, caldrà crear-ne l’enllaç/classificació expressament. No es pot deduir amb seguretat només per la direcció o l’import.
- Les valoracions antigues sense moneda, tipus o titular snapshot no reben dades inferides durant la migració. En editar-les, segueixen identificades com a valoracions sense tipus; qualsevol moneda o titular només s’hi afegirà si l’usuari ho desa explícitament.
- L’exportació ara és JSON v3 i incorpora transfers. La importació encara accepta v1 i v2, omplint les col·leccions que no existien amb llistes buides. Importar continua substituint les dades locals després de confirmar.

**Límits pendents abans de XIRR:** no hi ha dades de canvi de divisa, per tant no es pot obtenir una rendibilitat global comparable en EUR amb productes multidivisa. El patrimoni s’agrupa i es mostra separat per moneda sense sumar divises diferents. Els registres antics no tenen snapshots fiables de titular/moneda ni classificació externa/interna; requeriran revisió manual. Tampoc hi ha encara fluxos identificats com a comissions, impostos o altres conceptes, ni una política de dates incompletes/valor terminal; s’hauran de definir abans del càlcul. Cap càlcul XIRR ni gràfic s’ha afegit en aquesta fase.

## Fase 2.2 — rendibilitat agregada en EUR

IndexedDB passa de v3 a v4 amb una migració additiva: crea `exchangeRates` i conserva intactes els magatzems i registres previs. Cada canvi guarda moneda, data, `eurPerUnit` (EUR equivalents a una unitat de moneda estrangera) i observacions opcionals. L’EUR té canvi implícit 1. No es mantenen canvis fora del dispositiu.

La nova targeta de rendibilitat permet calcular el patrimoni global o el d’un titular, des de la primera valoració marcada com a inicial, des de l’inici de l’any natural o per un període personalitzat. La funció agregada construeix una única sèrie de fluxos amb valor inicial, aportacions/retirades externes i valor final en EUR; no suma ni fa mitjanes de percentatges individuals. La XIRR usa dies reals/365 i mostra rendibilitat acumulada, anualitzada, valor final, dates i antiguitat de cada valoració utilitzada.

Per a cada límit del període s’utilitza l’última valoració anterior o igual a la data de tall. El canvi de divisa s’exigeix exactament a la data del límit, a la data de cada moviment i a la data de cada costat d’un traspàs rellevant; no s’interpola. Valoracions de més de 30 dies generen un avís i el resultat es qualifica com a no plenament fiable. Un moviment o traspàs posterior a l’última valoració del producte bloqueja el resultat fins que s’actualitzi la posició.

Els traspassos entre productes del mateix titular no generen fluxos a la XIRR del titular. Els traspassos entre titulars generen sortida positiva per al titular d’origen i entrada negativa per al titular de destí, amb conversió per costat; al càlcul global s’exclouen completament per no alterar els fluxos externs del patrimoni conjunt. Els registres antics sense titular o naturalesa explícits no s’infereixen: els càlculs afectats s’aturen amb un avís.

L’exportació genera JSON v4 amb `exchangeRates`; la importació accepta còpies v1, v2, v3 i v4. Les versions antigues reben col·leccions buides per a les entitats que encara no existien. La XIRR individual de `returns.js` no s’ha alterat.

**Límits:** la titularitat de productes és actual i no hi ha un historial general de canvi de titularitat; calen traspassos explícits amb snapshots d’origen/destinació. Les valoracions copiades endavant poden ser antigues (advertides si superen 30 dies). Un període que no tingui una valoració inicial identificada, snapshots històrics de titularitat o canvis exactes a totes les dates requerides no tindrà un resultat fiable i es mostrarà com a insuficient.

Si un producte comença dins del període agregat, una primera valoració marcada `opening` (o l’àlies compatible `initial`) es compta com a capital inicial negatiu a la seva data, sempre que no hi hagi ja una aportació o traspàs d’entrada registrat per representar aquest capital.

## Manteniment de moviments i diagnòstic XIRR

Els moviments existents es poden editar conservant-ne l’identificador, la naturalesa, el titular, la moneda i `createdAt`; només es modifiquen tipus, data, import i observacions. L’eliminació requereix confirmació i elimina únicament el registre seleccionat. Després de canvis, es tornen a calcular la fitxa individual i la vista agregada.

La traça agregada mostra els components ordenats per data (incloent producte i concepte) i els fluxos nets per data que determinen els canvis de signe. No filtra fluxos per forçar una XIRR; si hi ha més d’un canvi, conserva l’avís i mostra quins components provoquen cada transició.

## Fase 2.1 — rendibilitat XIRR individual de producte

La fitxa calcula la rendibilitat en memòria en obrir el producte; no desa cap resultat ni modifica IndexedDB. La base continua a v3. El càlcul utilitza la convenció XIRR de dies reals/365: aportacions i capital inicial negatius des del punt de vista de l’inversor; retirades positives; traspassos entrants al producte negatius i traspassos sortints positius. Els traspassos s’utilitzen només al càlcul del producte corresponent, amb l’import i la moneda guardats per aquell costat. No es converteixen divises.

La valoració marcada explícitament com opening és el capital inicial i ha de precedir els fluxos del període. Sense aquesta marca, el període pot començar al primer flux classificat només quan no hi ha valoracions anteriors que indiquin capital preexistent. L’última valoració és el valor final positiu; les valoracions intermèdies no són fluxos. L’XIRR anualitzada es transforma en rendibilitat acumulada elevant el factor de creixement als dies del període dividits per 365.

Si hi ha moviments pendents de classificar, dades incoherents, falta de fluxos positius/negatius o més d’un canvi de signe cronològic (que podria donar més d’una arrel), la fitxa explica per què no mostra cap percentatge. Els registres antics sense tipus no s’interpreten automàticament com a capital inicial. En les dades presents durant la implementació hi havia valoracions antigues sense tipus explícit i cap moviment/traspàs; cal marcar la valoració inicial de cada producte abans d’obtenir una XIRR fiable.

La implementació no afegeix rendibilitat per titular ni global, selecció de períodes, conversions de divisa ni gràfics.
