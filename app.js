let express = require('express');
let cors = require('cors');
let { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
let propertiesReader = require('properties-reader');
let path = require('path');
const fs = require('fs');
let app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
    console.log(req.method, req.url);
    next();
});

// Static file handling
const imagePath = path.resolve(__dirname, "images");
app.use('/images', express.static(imagePath));
// app.use('/images/:imageName', (req, res, next) => {
//     const fullPath = path.join(imagePath, req.params.imageName);
//     fs.access(fullPath, fs.constants.F_OK, (err) => {
//         if (err) {
//             res.status(404).send('Image not found');
//         } else {
//             res.sendFile(fullPath);
//         }
//     });
// });

// Load properties
const propertiesPath = path.resolve(__dirname, "conf/db.properties");
const properties = propertiesReader(propertiesPath);

const dbPrefix = properties.get("db.prefix");
const dbUsername = encodeURIComponent(properties.get("db.user"));
const dbPwd = encodeURIComponent(properties.get("db.pwd"));
const dbName = properties.get("db.dbName");
const dbUrl = properties.get("db.dbUrl");
const dbParams = properties.get("db.params");

// MongoDB URI
const uri = `${dbPrefix}${dbUsername}:${dbPwd}${dbUrl}${dbParams}`;

// MongoDB Client
const client = new MongoClient(uri, { serverApi: ServerApiVersion.v1 });
let db;

// Connect to MongoDB
client.connect()
    .then(() => {
        console.log('Connected to MongoDB Atlas');
        db = client.db(dbName);
    })
    .catch((err) => {
        console.error('Error connecting to MongoDB Atlas:', err);
    });

// Routes
app.get('/', (req, res) => {
    res.send('Welcome to our page');
});

// app.param middleware
app.param('collectionName', (req, res, next, collectionName) => {
   
    try {
        req.collection = db.collection(collectionName);
        console.log(`Accessing collection: ${collectionName}`);
        next();
    } catch (error) {
        next(error);
    }
//     req.collection = db.collection(collectionName);
//  return next();
});

// Get all documents from a collection
app.get('/collections/:collectionName', (req, res, next) => {
    req.collection
        .find({},{ sort: [["price",-1]]})
        .toArray()
        .then((results) => res.send(results))
        .catch((err) => {
            console.error(err);
            next(err);
        });
});

// Limiting and sorting
app.get('/collections/:collectionName/:max/:sortAspect/:sortAscDesc', (req, res, next) => {
    const max = parseInt(req.params.max, 10);
    const sortDirection = req.params.sortAscDesc === "desc" ? -1 : 1;
    const sortAspect = req.params.sortAspect;

    req.collection
        .find({},{limit:max,sort:[sortAspect,sortDirection]})
        .toArray()
        .then((results) => res.send(results))
        .catch((err) => {
            console.error(err);
            next(err);
        });
});

// getting single activity
app.get('/collections/:collectionName/:id'
    , function(req, res, next) {
    try{
        const objectId = new ObjectId(req.params.id);
        req.collection.findOne({_id: objectId})
        .then((result)=>{
            if(!result){
                return res.status(404).send("Document not found")
            }
            res.send(result);
        })
        .catch((err)=>{
            next(err);
        });
    }catch(err){
        res.status(400).send('Invalid ID format');
    }
     });

// Search
app.get('/search', async function (req, res) {
    const collection = db.collection("activities");
    const searchWord = req.query.q || ''; 
    const sortKey = req.query.sortKey || 'Activity'; 
    const order = req.query.order || 'ASC'; 
   

    try {
        let searchQuery = {};
        if (searchWord) {
           
            const parsedWord = parseFloat(searchWord); // Try to parse numeric input
            searchQuery = {
                $or: [
                    { title: { $regex: searchWord, $options: 'i' } },
                    { location: { $regex: searchWord, $options: 'i' } },
                    { description: { $regex: searchWord, $options: 'i' } },
                    ...(isNaN(parsedWord)
                        ? [] // Skip numeric fields if searchWord isn't numeric
                        : [
                              { price: { $eq: parsedWord } },
                              { availableSpace: { $eq: parsedWord } },
                          ]),
                ],
            };
        }

        // Query the MongoDB database with the search criteria
        const activities = await collection.find(searchQuery).toArray();

        // Sort the results based on the sortKey and order
        activities.sort((a, b) => {
            let comparison = 0;

            if (sortKey === 'Price') {
                comparison = a.price - b.price;
            } else if (sortKey === 'Activity') {
                comparison = a.title.localeCompare(b.title);
            } else if (sortKey === 'Location') {
                comparison = a.location.localeCompare(b.location);
            } else if (sortKey === 'Availability') {
                comparison = a.availableSpace - b.availableSpace;
            }

            return order === 'ASC' ? comparison : -comparison;
        });

        // Send the filtered and sorted activities back to the client
        res.json(activities);

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error occurred during search' });
    }
});



// Add a document to a collection
app.post('/collections/:collectionName', (req, res, next) => {
    req.collection
        .insertOne(req.body)
        .then((result) => res.status(201).send(result))
        .catch((err) => {
            console.error(err);
            next(err);
        });
});

// update order using PUT
app.put('/collections/:collectionName/:id', (req, res, next) => {
    const { id } = req.params;
    const updateData = req.body;

    try {
        const objectId = new ObjectId(id); 
        req.collection
            .updateOne(
                { _id: objectId },
                { $set: updateData },
                { upsert: false } 
            )
            .then((result) => {
                if (result.matchedCount === 0) {
                    return res.status(404).send({ message: "Document not found" });
                }
                res.status(200).send({ message: "Document updated successfully", result });
            })
            .catch((error) => {
                console.error("Update Error:", error);
                next(error);
            });
    } catch (error) {
        console.error("Invalid ID format:", error);
        res.status(400).send({ message: "Invalid ID format" });
    }
});
// 404 Handler
app.use((req, res) => {
    res.status(404).send('No page found');
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong!');
});

// Start server
const port = process.env.PORT ;
app.listen(port, () => {
    console.log('Listening at port ' + port);
});

