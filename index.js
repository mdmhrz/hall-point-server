require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
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
        const mealsCollection = db.collection('meals');
        const mealRequestsCollection = db.collection('mealRequests');
        const reviewsCollection = db.collection("reviews");
        const paymentsCollection = db.collection("payments");


        // payment 

        // for payment confirmation from stripe
        app.post('/create-payment-intent', async (req, res) => {
            const amountInCents = req.body.amountInCents;

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amountInCents, // Stripe works in cents
                currency: 'usd', // or 'bdt' if applicable for test
                payment_method_types: ['card'],
            });

            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });


        //Post api for payments and update parcels collection payment status
        app.post('/payments', async (req, res) => {
            const { name, email, amount, paymentMethod, transactionId, badge } = req.body;



            // Step 1: Change User Badge
            const updateResult = await usersCollection.updateOne(
                { email: email },
                {
                    $set: {
                        badge: badge
                    }
                }
            );


            // Step 2: Save payment history
            const paymentEntry = {
                name,
                email, // user email
                amount,
                paymentMethod,
                transactionId,
                paid_at: new Date(),
                paid_at_string: new Date().toISOString(),
                paid_for: badge
            };

            const insertResult = await paymentsCollection.insertOne(paymentEntry);

            res.send({
                message: 'Payment recorder and user membership badge changed',
                insertdId: insertResult.insertedId
            });
        });


        //****************************************/
        //*******    User Related Api     ********/
        //****************************************/

        //get specific user by email
        app.get('/users', async (req, res) => {
            const email = req.query.email;
            const result = await usersCollection.findOne({ email });
            res.send(result)
        })


        //to get all users
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


        //****************************************/
        //*******    Meals Related Api     ********/
        //****************************************/

        // app.get('/meals/all')

        app.get('/meals', async (req, res) => {
            const page = parseInt(req.query.page) || 0;
            const limit = parseInt(req.query.limit) || 6;
            const search = req.query.search || '';
            const category = req.query.category || '';
            const priceRange = req.query.priceRange || '';

            const query = {};

            if (search) {
                query.title = { $regex: search, $options: 'i' };
            }

            if (category) {
                query.category = category;
            }

            if (priceRange) {
                const [min, max] = priceRange.split('-').map(Number);
                query.price = { $gte: min, $lte: max };
            }

            try {
                const total = await mealsCollection.countDocuments(query);
                const meals = await mealsCollection.find(query)
                    .skip(page * limit)
                    .limit(limit)
                    .toArray();

                res.send({
                    meals,
                    hasMore: (page + 1) * limit < total,
                });
            } catch (err) {
                console.error(err);
                res.status(500).send({ message: 'Error fetching meals' });
            }
        });


        //to get meal data by id
        // GET Meal by ID
        app.get("/meals/:id", async (req, res) => {
            const { id } = req.params;

            try {
                const query = { _id: new ObjectId(id) };
                const meal = await mealsCollection.findOne(query);

                if (!meal) {
                    return res.status(404).send({ message: "Meal not found" });
                }

                res.send(meal);
            } catch (err) {
                res.status(500).send({ message: "Invalid meal ID", error: err.message });
            }
        });


        //Get Reviews by Meal Id
        app.get("/meals/:id/reviews", async (req, res) => {
            const mealId = req.params.id;

            try {
                const reviews = await reviewsCollection
                    .find({ mealId: new ObjectId(mealId) })
                    .sort({ date: -1 }) // optional: show latest first
                    .toArray();

                res.send(reviews);
            } catch (error) {
                console.error("Failed to fetch reviews:", error);
                res.status(500).send({ message: "Server error fetching reviews", error: error.message });
            }
        });



        //To create new meal data
        app.post('/meals', async (req, res) => {
            const meal = req.body;
            const result = await mealsCollection.insertOne(meal);
            res.send(result)
        });


        //Create Reviews for meal and count review for meal
        app.post("/meals/:id/reviews", async (req, res) => {
            const mealId = req.params.id;
            const { user, email, comment, rating } = req.body;

            if (!user || !email || !comment || rating == null) {
                return res.status(400).send({ message: "Missing review fields" });
            }

            try {
                const review = {
                    mealId: new ObjectId(mealId),
                    user,
                    email,
                    comment,
                    rating: parseInt(rating),
                    date: new Date().toISOString(),
                };

                const result = await reviewsCollection.insertOne(review);

                // Update review count in mealsCollection
                await mealsCollection.updateOne(
                    { _id: new ObjectId(mealId) },
                    { $inc: { reviews_count: 1, rating: 1 } }
                );

                res.send({ success: true, message: "Review added", result });
            } catch (error) {
                res.status(500).send({ success: false, message: "Failed to post review", error: error.message });
            }
        });


        // PATCH: Increment like count
        app.patch("/meals/:id/like", async (req, res) => {
            const { id } = req.params;

            try {
                const filter = { _id: new ObjectId(id) };
                const update = {
                    $inc: { likes: 1 },
                };

                const result = await mealsCollection.updateOne(filter, update);

                if (result.modifiedCount === 0) {
                    return res.status(404).send({ message: "Meal not found or already liked" });
                }

                res.send({ message: "Like updated", result });
            } catch (error) {
                res.status(500).send({ message: "Failed to update like count", error: error.message });
            }
        });




        //****************************************/
        //*******    Meal Request Related Api     ********/
        //****************************************/


        // GET /meal-requests?mealId=xxx&userEmail=yyy
        app.get('/meal-requests', async (req, res) => {
            const { mealId, userEmail } = req.query;

            const exists = await mealRequestsCollection.findOne({ mealId, userEmail });

            res.send({ exists: !!exists });
        });


        // POST /meal-requests
        app.post('/meal-requests', async (req, res) => {
            const request = req.body;
            const exists = await mealRequestsCollection.findOne({
                mealId: request.mealId,
                userEmail: request.userEmail,
            });

            if (exists) {
                return res.status(400).send({ message: "Already requested" });
            }

            const result = await mealRequestsCollection.insertOne(request);
            res.send(result);
        });













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