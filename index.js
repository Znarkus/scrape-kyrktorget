'use strict'

const fs = require('fs')
const path = require('path')
const axios = require('axios')
const _ = require('lodash')
const csvStringify = require('csv-stringify')

const EMAIL_REGEX = /(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))/mg
const BASE64_REGEX = /data:image\/[a-z]+;base64,[+a-z0-9\/=]+/img
const PARALLEL = 1
const REGIONS = {
  1: 'Blekinge län',
  2: 'Dalarnas län',
  4: 'Gävleborgs län',
  3: 'Gotlands län',
  5: 'Hallands län',
  6: 'Jämtlands län',
  7: 'Jönköpings län',
  8: 'Kalmar län',
  9: 'Kronobergs län',
  10: 'Norrbottens län',
  20: 'Örebro län',
  21: 'Östergötlands län',
  11: 'Skåne län',
  13: 'Södermanlands län',
  12: 'Stockholms län',
  14: 'Uppsala län',
  15: 'Värmlands län',
  16: 'Västerbottens län',
  17: 'Västernorrlands län',
  18: 'Västmanlands län',
  19: 'Västra Götalands län',
}

main().catch(console.error)

async function main () {
  for (let regionId = 1; regionId <= 20; regionId++) {
    const REGION_COMPLETE_PATH = `region${regionId}.complete`

    if (fs.existsSync(REGION_COMPLETE_PATH)) {
      console.log('region', regionId, 'already completed')
      continue
    }

    console.log('starting region', regionId)

    const CSV_PATH = `churches-region${regionId}.csv`
    console.log('writing to', CSV_PATH)

    const csv = openCsvWrite(CSV_PATH)

    const churches = await loadList(regionId)

    const CHUNK_SIZE = Math.floor(churches.length / PARALLEL)
    await Promise.all(_.chunk(churches, CHUNK_SIZE).map(async churchChunk => {
      for (const church of churchChunk) {
        const CHURCH_URL = 'https://www.kyrktorget.se/'
          + (church.shortname || 'church/' + church.id)

        console.log('fetching', CHURCH_URL)
        const res = await retryPromise(() => axios.get(CHURCH_URL, {
          timeout: 3000,
        }))

        if (!res) {
          console.error('error while fetching html for', church)
          continue
        }

        console.log('received response')

        const churchHtml = res.replace(
          BASE64_REGEX,
          '' // strip massive base64 data that might break the email regex
        )

        church.emails = _.uniq(churchHtml.match(EMAIL_REGEX))
        church.region = REGIONS[regionId]

        console.log(church.title, church.emails)
        csv.write([ church.region, church.title, CHURCH_URL, ...church.emails ])
      }
    }))

    csv.end()
    await fs.promises.writeFile(REGION_COMPLETE_PATH, '')
  }
}

function openCsvWrite (csvPath) {
  const fd = fs.createWriteStream(csvPath)
  const csv = csvStringify({
    quoted: true
  })

  csv.pipe(fd)
  csv.on('error', (err) => {
    console.error(err)
  })

  return csv
}

async function loadList (regionId) {
  const REGION_LIST_PATH = `region${regionId}.list.json`

  if (fs.existsSync(REGION_LIST_PATH)) {
    console.log('loading cached list for region', regionId)
    return require(path.resolve(REGION_LIST_PATH))
  }

  console.log('loading list for region', regionId)

  const LIST_URL = 'https://www.kyrktorget.se/api/filter?type=lan&ids='
    + regionId

  const { data: churches } = await axios.post(LIST_URL)

  console.log('list loaded')

  await fs.promises.writeFile(
    REGION_LIST_PATH,
    JSON.stringify(churches, null, 2)
  )

  return churches
}

async function retryPromise (promiseCb) {
  for (let retry = 0; retry < 3; retry++) {
    if (retry > 0) console.log(`retry number ${retry}`)

    try {
      return await promiseCb()
    } catch (err) {
      console.error(err.toString())
    }
  }
}
