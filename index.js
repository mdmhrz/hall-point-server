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
        const upcomingMealsCollection = db.collection("upcomingMeals");


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
        app.get('/users/all', async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result)
        })


        // GET /users/search?keyword=xyz
        app.get("/users/search", async (req, res) => {
            try {
                const keyword = req.query.keyword?.trim();

                if (!keyword) {
                    return res.status(400).json({ message: "Search keyword is required." });
                }

                const regex = new RegExp(keyword, "i"); // "i" = case-insensitive

                const users = await usersCollection.find({
                    $or: [
                        { name: { $regex: regex } },
                        { email: { $regex: regex } },
                    ],
                }).toArray(); // Exclude sensitive fields

                res.status(200).json(users);
            } catch (error) {
                console.error("Search error:", error);
                res.status(500).json({ message: "Server error" });
            }
        });


        // GET user role by email
        app.get("/users/role", async (req, res) => {
            try {
                const email = req.query.email;

                if (!email) {
                    return res.status(400).json({ error: "Email query parameter is required" });
                }

                const user = await usersCollection.findOne({ email });

                if (!user) {
                    return res.status(404).json({ error: "User not found" });
                }

                res.json({ role: user.role || "user" }); // fallback if role not set
            } catch (error) {
                console.error("Error fetching user role:", error);
                res.status(500).json({ error: "Internal server error" });
            }
        });


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


        // PATCH: Update user role
        app.patch("/users/update-role/:id", async (req, res) => {
            try {
                const userId = req.params.id;
                const { role } = req.body;

                console.log(role);

                if (!role || !["admin", "user"].includes(role)) {
                    return res.status(400).json({ message: "Invalid or missing role." });
                }

                const result = await usersCollection.updateOne(
                    { _id: new ObjectId(userId) },
                    { $set: { role } }
                );

                if (result.modifiedCount === 0) {
                    return res.status(404).json({ message: "User not found or role unchanged." });
                }

                res.json({ message: "User role updated successfully", updatedId: userId });
            } catch (error) {
                console.error("Error updating user role:", error);
                res.status(500).json({ message: "Internal server error" });
            }
        });








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


        // get all meal without filtering
        app.get('/meals/all', async (req, res) => {
            const result = await mealsCollection.find().toArray();
            res.send(result)
        })


        // Get all meal data sorted by like review count
        app.get('/meals/sorted', async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                const skip = (page - 1) * limit;

                const totalCount = await mealsCollection.countDocuments();

                const meals = await mealsCollection
                    .find()
                    .sort({ likes: -1, reviews_count: -1 })
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.send({
                    totalCount,               // total items count
                    page,
                    limit,
                    totalPages: Math.ceil(totalCount / limit),
                    data: meals               // array of meals
                });
            } catch (error) {
                console.error("Failed to fetch sorted meals:", error);
                res.status(500).send({ message: "Internal server error" });
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


        // get distributor meals by distributor email 
        app.get('/meals/distributor/:email', async (req, res) => {
            try {
                const email = req.params.email;

                const meals = await mealsCollection
                    .find({ distributor_email: email })
                    .toArray();

                res.send(meals);
            } catch (error) {
                console.error("Error fetching meals by distributor:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });


        //To create new meal data
        app.post('/meals', async (req, res) => {
            const meal = req.body;
            console.log(meal);
            const result = await mealsCollection.insertOne(meal);
            res.send(result)
        });

        //Update whole meal data 
        app.patch('/meals/update/:id', async (req, res) => {
            try {
                const mealId = req.params.id;
                const updateData = req.body;
                // console.log('meal id', mealId, 'updatedate', updateData);

                const result = await mealsCollection.updateOne(
                    { _id: new ObjectId(mealId) },
                    { $set: updateData }
                );

                if (result.modifiedCount > 0) {
                    res.send({ success: true, message: 'Meal updated successfully' });
                } else {
                    res.status(404).send({ success: false, message: 'Meal not found or already updated' });
                }
            } catch (error) {
                console.error('Failed to update meal:', error);
                res.status(500).send({ success: false, message: 'Internal server error' });
            }
        });


        // DELETE meal from all meals collection /-meals/:id
        app.delete('/meals/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                console.log(query);

                const result = await mealsCollection.deleteOne(query);
                res.send(result);
            } catch (error) {
                console.error('Error deleting upcoming meal:', error);
                res.status(500).send({ message: 'Failed to delete upcoming meal.' });
            }
        });








        //***************************************************/
        //*******    Review of meals Related Api     ********/
        //***************************************************/

        // get all review in an array
        app.get('/reviews', async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                const skip = (page - 1) * limit;

                const reviewsCursor = reviewsCollection.find().skip(skip).limit(limit);
                const totalReviews = await reviewsCollection.estimatedDocumentCount();
                const reviews = await reviewsCursor.toArray();

                res.send({
                    reviews,
                    total: totalReviews,
                    page,
                    limit,
                });
            } catch (error) {
                console.error("Failed to fetch reviews:", error);
                res.status(500).send({ message: "Internal server error" });
            }
        });



        //Get Reviews by Meal Id
        app.get("/meals/:id/reviews", async (req, res) => {
            const mealId = req.params.id;

            try {
                const reviews = await reviewsCollection
                    .find({ mealId: new ObjectId(mealId) })
                    .sort({ posted_at: -1 }) // optional: show latest first
                    .toArray();

                res.send(reviews);
            } catch (error) {
                console.error("Failed to fetch reviews:", error);
                res.status(500).send({ message: "Server error fetching reviews", error: error.message });
            }
        });


        // Get all reviews of an user by user email
        app.get("/reviews/user", async (req, res) => {
            try {
                const email = req.query.email;

                if (!email) {
                    return res.status(400).json({ message: "Email query is required." });
                }

                const reviews = await reviewsCollection.find({ email: email }).toArray();
                res.status(200).json(reviews);
            } catch (error) {
                console.error("Error fetching user reviews:", error);
                res.status(500).json({ message: "Server error while fetching reviews." });
            }
        });


        //Create Reviews for meal and count review for meal
        app.post("/meals/:id/reviews", async (req, res) => {
            const mealId = req.params.id;
            const { mealTitle, user, email, comment, rating } = req.body;

            if (!user || !email || !comment || rating == null) {
                return res.status(400).send({ message: "Missing review fields" });
            }

            try {
                const review = {
                    mealId: new ObjectId(mealId),
                    mealTitle,
                    user,
                    email,
                    comment,
                    rating: parseInt(rating),
                    posted_at: new Date().toISOString(),
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


        // Update individual review by user 
        app.patch('/reviews/:id', async (req, res) => {
            const { id } = req.params;
            const updatedData = req.body;

            try {
                const result = await reviewsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updatedData }
                );

                if (result.modifiedCount > 0) {
                    res.status(200).json({ message: "Review updated successfully." });
                } else {
                    res.status(404).json({ message: "Review not found or no change made." });
                }
            } catch (error) {
                console.error("Update review error:", error);
                res.status(500).json({ message: "Server error while updating review." });
            }
        });



        // Delete one review and decrement the reviews_count form meals collection
        app.delete('/reviews/:id', async (req, res) => {
            try {
                const reviewId = req.params.id;

                // Find the review to get associated meal_id
                const review = await reviewsCollection.findOne({ _id: new ObjectId(reviewId) });

                if (!review) {
                    return res.status(404).send({ success: false, message: 'Review not found' });
                }

                // Delete the review
                const deleteResult = await reviewsCollection.deleteOne({ _id: new ObjectId(reviewId) });

                // If deletion successful, decrease the review count from the meal
                if (deleteResult.deletedCount > 0) {
                    await mealsCollection.updateOne(
                        { _id: new ObjectId(review.mealId) },
                        { $inc: { reviews_count: -1 } }
                    );

                    return res.send({
                        success: true,
                        message: 'Review deleted and meal review count updated',
                    });
                } else {
                    return res.status(500).send({ success: false, message: 'Failed to delete review' });
                }

            } catch (error) {
                console.error('Error deleting review:', error);
                res.status(500).send({ success: false, message: 'Internal server error' });
            }
        });









        //****************************************/
        //*******    Meal Request Related Api     ********/
        //****************************************/


        // GET specific meal request object thourgh email.
        // /meal-requests?mealId=xxx&userEmail=yyy
        app.get('/meal-requests', async (req, res) => {
            const { mealId, userEmail } = req.query;

            const exists = await mealRequestsCollection.findOne({ mealId, userEmail });

            res.send({ exists: !!exists });
        });


        // GET all meal request object thourgh email.
        // /meal-requests?mealId=xxx&userEmail=yyy
        app.get('/meal-requests/user', async (req, res) => {
            const email = req.query.email;

            const result = await mealRequestsCollection.find({ userEmail: email }).toArray();

            res.send(result);
        });


        // GET /meal-requests?mealId=xxx&userEmail=yyy
        app.get('/meal-requests/all', async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                const skip = (page - 1) * limit;

                const total = await mealRequestsCollection.countDocuments();
                const requests = await mealRequestsCollection
                    .find()
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.send({
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit),
                    data: requests
                });
            } catch (error) {
                console.error("Failed to fetch meal requests:", error);
                res.status(500).send({ message: "Server error" });
            }
        });




        // To implement search functionality in meal request 

        app.get('/meal-requests/search', async (req, res) => {
            try {
                const keyword = req.query.keyword || "";
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                const skip = (page - 1) * limit;

                const query = {
                    userEmail: { $regex: keyword, $options: "i" },
                };

                const total = await mealRequestsCollection.countDocuments(query);
                const requests = await mealRequestsCollection
                    .find(query)
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.send({
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit),
                    data: requests
                });
            } catch (err) {
                res.status(500).send({ message: "Search error", error: err.message });
            }
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


        // Meals request status update api
        app.patch('/meal-requests/serve/:id', async (req, res) => {
            const { id } = req.params;
            const result = await mealRequestsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status: "on serving" } }
            );
            res.send(result);
        });


        //// DELETE a meal request by ID
        app.delete("/mealRequests/:id", async (req, res) => {
            try {
                const id = req.params.id;
                const result = await mealRequestsCollection.deleteOne({ _id: new ObjectId(id) });

                if (result.deletedCount > 0) {
                    res.status(200).json({ message: "Meal request deleted" });
                } else {
                    res.status(404).json({ message: "Meal request not found" });
                }
            } catch (error) {
                console.error("Error deleting meal request:", error);
                res.status(500).json({ message: "Internal server error" });
            }
        });











        //****************************************/
        //*******    Upcoming Meals Related Api     ********/
        //****************************************/

        //Get all upcoming meals

        app.get("/upcoming-meals", async (req, res) => {
            try {
                const upcomingMeals = await upcomingMealsCollection.find().toArray();
                res.status(200).json(upcomingMeals);
            } catch (error) {
                console.error("Failed to fetch upcoming meals:", error);
                res.status(500).json({ message: "Server error while fetching upcoming meals" });
            }
        });

        //Get upcoming meals sorted by likes count

        app.get("/upcoming-meals/sorted", async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                const skip = (page - 1) * limit;

                const totalMeals = await upcomingMealsCollection.countDocuments();

                const upcomingMeals = await upcomingMealsCollection
                    .find()
                    .sort({ likes: -1 }) // Sort by likes descending
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.status(200).json({
                    total: totalMeals,
                    page,
                    limit,
                    totalPages: Math.ceil(totalMeals / limit),
                    data: upcomingMeals,
                });
            } catch (error) {
                console.error("Failed to fetch sorted upcoming meals:", error);
                res.status(500).json({ message: "Server error while fetching meals" });
            }
        });



        // new upcoming meals post
        app.post("/upcoming-meals", async (req, res) => {
            try {
                const mealData = req.body;

                // Optional: validate required fields
                const requiredFields = ["title", "category", "cuisine", "image", "ingredients", "description", "price", "prep_time", "distributor_name", "distributor_email"];
                const isValid = requiredFields.every(field => mealData[field] !== undefined && mealData[field] !== null);

                if (!isValid) {
                    return res.status(400).json({ message: "Missing required fields" });
                }

                // Add extra metadata if needed
                mealData.status = "upcoming";
                mealData.rating = 0;
                mealData.likes = 0;
                mealData.reviews_count = 0;
                mealData.posted_at = new Date().toISOString();

                const result = await upcomingMealsCollection.insertOne(mealData);
                res.status(201).json({ insertedId: result.insertedId });
            } catch (error) {
                console.error("Failed to add upcoming meal:", error);
                res.status(500).json({ message: "Server error while adding upcoming meal" });
            }
        });



        // Upcoming meals like count and if likes reach 10 it will publish and remove from upcoming meals collection.
        app.patch("/upcoming-meals/like/:id", async (req, res) => {
            const mealId = req.params.id;
            const userEmail = req.body.email;

            if (!userEmail) {
                return res.status(400).send({ success: false, message: "User email is required" });
            }

            try {
                const meal = await upcomingMealsCollection.findOne({ _id: new ObjectId(mealId) });

                if (!meal) {
                    return res.status(404).send({ success: false, message: "Meal not found" });
                }

                // Prevent duplicate likes
                if (meal.liked_by?.includes(userEmail)) {
                    return res.status(400).send({ success: false, message: "You already liked this meal" });
                }

                // Increment like and add user
                await upcomingMealsCollection.updateOne(
                    { _id: new ObjectId(mealId) },
                    {
                        $inc: { likes: 1 },
                        $addToSet: { liked_by: userEmail }
                    }
                );

                // Fetch the updated meal manually
                const updatedMeal = await upcomingMealsCollection.findOne({ _id: new ObjectId(mealId) });

                if (!updatedMeal) {
                    return res.status(500).send({ success: false, message: "Failed to retrieve updated meal." });
                }

                // If likes reach 10, publish it to meals collection
                if (updatedMeal.likes >= 10) {
                    const {
                        _id,
                        liked_by,
                        status,
                        ...rest
                    } = updatedMeal;

                    const mealToInsert = {
                        ...rest,
                        rating: 0,
                        likes: 0,
                        reviews_count: 0,
                        posted_at: new Date(),
                    };

                    // Insert to main collection
                    await mealsCollection.insertOne(mealToInsert);
                    // Remove from upcoming
                    await upcomingMealsCollection.deleteOne({ _id: new ObjectId(mealId) });

                    return res.send({
                        success: true,
                        message: "Maximum likes reached! The meal is now live in the regular meals.",
                        published: true
                    });
                }

                // Normal success response if not yet published
                res.send({
                    success: true,
                    message: "Liked successfully.",
                    updatedLikes: updatedMeal.likes,
                    published: false
                });

            } catch (error) {
                console.error("Like failed:", error);
                res.status(500).send({ success: false, message: "Internal Server Error" });
            }
        });




        //Delete upcoming meals when its being published
        // DELETE /upcoming-meals/:id
        app.delete('/upcoming-meals/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const query = { _id: new ObjectId(id) };
                console.log(query);

                const result = await upcomingMealsCollection.deleteOne(query);
                res.send(result);
            } catch (error) {
                console.error('Error deleting upcoming meal:', error);
                res.status(500).send({ message: 'Failed to delete upcoming meal.' });
            }
        });






        //****************************************/
        //*******   Payments Related Api   *******/
        //****************************************/


        //Get payment history by user email
        //  GET /payments/user?email=user@mail.com
        app.get('/payments/user', async (req, res) => {
            const email = req.query.email;

            if (!email) {
                return res.status(400).json({ message: "Email is required." });
            }

            try {
                const payments = await paymentsCollection
                    .find({ email })
                    .sort({ paid_at: -1 }) // latest payments first
                    .toArray();

                res.status(200).json(payments);
            } catch (error) {
                console.error("Error fetching payments:", error);
                res.status(500).json({ message: "Failed to fetch payment history." });
            }
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