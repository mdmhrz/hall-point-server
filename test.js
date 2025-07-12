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
    const keyword = req.query.keyword;
    const query = keyword
        ? {
            $or: [
                { userEmail: { $regex: keyword, $options: "i" } },
                { userName: { $regex: keyword, $options: "i" } },
            ]
        }
        : {};

    const requests = await mealRequestsCollection.find(query).toArray();
    res.send(requests);
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