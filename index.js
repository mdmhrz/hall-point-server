require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
// const admin = require("firebase-admin");


const app = express();
const port = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());


//MongoDB
const uri = process.env.MONGO_URI;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();

        //DB AND COLLECTIONS
        const db = client.db('hallPointDB');
        const usersCollection = db.collection('users');




        //*******    User Related Api     ********/
        app.get('/users', async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result)
        })

        //Add user in User Collection when a user register
        app.post('/users', async (req, res) => {
            const email = req.body.email;

            const userExists = await usersCollection.findOne({ email })
            if (userExists) {
                return res.status(200).send({ message: 'User already exist', inserted: false })
            }

            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result)
        })









        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);

app.get('/', async (req, res) => {
    res.send('Welcome to the HallPoint Server');

});


// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});