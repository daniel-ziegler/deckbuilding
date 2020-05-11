import  express from 'express'
import path from 'path'
const PORT = process.env.PORT || 5000
import {verifyScore} from './public/logic.js'

import postgres from 'postgres'
const sql = postgres(process.env.DATABASE_URL)

//TODO: get rid of these any's
//TODO: this is probably horribly insecure

function renderTimeSince(date) {
    let secondsAgo = ((new Date()).getTime() - date.getTime()) / 1000;
    const units = [
        ["year", 31536000],
        ["month", 2592000],
        ["day", 86400],
        ["hour", 3600],
        ["minute", 60],
        ["second", 1],
    ]
    for (const [unitName, unitSize] of units) {
        const unitsAgo = Math.floor(secondsAgo / unitSize)
        if (unitsAgo > 1) return `${unitsAgo} ${unitName}s ago`
    }
    return 'Just now'
}

express()
    .use(express.static(path.join(__dirname, 'public')))
    .set('views', path.join(__dirname), 'views')
    .set('view engine', 'ejs')
    .get('/topScore', async (req, res) => {
      try {
          const seed = req.query.seed
          const results = await sql`
              SELECT username, score, submitted FROM scoreboard
              WHERE seed=${seed}
              ORDER BY score ASC, submitted ASC
          `
          if (results.length == 0)
              res.send('null')
          else
              res.send(results[0].score.toString())
      } catch(err) {
          console.error(err);
          res.send('Error: ' + err);
      }
    })
    .get('/scoreboard', async (req, res) => {
      try {
          const seed = req.query.seed
          const results = await sql`
              SELECT username, score, submitted FROM scoreboard
              WHERE seed=${seed}
              ORDER BY score ASC, submitted ASC
          `
          const entries = results.map((x) => ({...x, timesince:renderTimeSince(x.submitted)}))
          res.render('pages/scoreboard', {entries:entries, seed:seed});
      } catch(err) {
          console.error(err);
          res.send('Error: ' + err);
      }
    })
    .post('/submit', async (req, res) => {
        try {
            const seed = req.query.seed
            const score = req.query.score
            const username = req.query.username
            const history = req.query.history
            const [valid, explanation] = await verifyScore(seed, history, score)
            if (valid) {
                const results = await sql`
                  INSERT INTO scoreboard (username, score, seed)
                  VALUES (${username}, ${score}, ${seed})
                `
                res.send(`Score logged!`)
            } else {
                res.send(`Score did not validate: ${explanation}`)
            }
        } catch(err) {
          console.error(err);
          res.send('Error: ' + err);
        }
    })
    .listen(PORT, () => console.log(`Listening on ${ PORT }`))
