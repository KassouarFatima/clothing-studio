import express from 'express'
import * as dotenv from 'dotenv'
import cors from 'cors'
import dalleRoutes from './route/dalle.routes.js'
import tryOnRoutes from './route/tryon.routes.js'
import chatRoutes from './route/chat.routes.js'
import handoffRoutes from './route/handoff.routes.js'


dotenv.config();

const app=express();
app.set('trust proxy', false);
app.use(cors());
// clothing-studio: the site-to-site design handoff parses its own (large)
// base64 body, so it must be mounted before the 16kb global JSON parser.
app.use('/api/v1/handoff', handoffRoutes)
app.use(express.json({limit:"16kb"}))

app.use('/api/v1/dalle',dalleRoutes)
app.use('/api/v1/tryon',tryOnRoutes)
app.use('/api/v1/chat',chatRoutes)
app.get('/',(req,res)=>{
    res.status(200).json({message:"Shirt image generation backend"})
})

const port = Number(process.env.PORT) || 8080;
app.listen(port,()=>console.log(`Server has started on port ${port}`))
