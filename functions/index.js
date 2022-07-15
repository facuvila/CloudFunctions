const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

//Run when a user is created in FirebaseAuth, creates his profile in Firestore.
exports.createProfile = functions.auth.user().onCreate((user) => {
    return admin.firestore().collection('users').doc(user.uid).set({
        email: user.email,
        balance: 0,
        contributedTrees: 0, //Árboles aportados
        contacts: [],
        isVendor: false
    });
});


//Run when a user is deleted in FirebaseAuth, deletes his profile in Firestore.
exports.deleteProfile = functions.auth.user().onDelete((user) => {
    return admin.firestore().collection('users').doc(user.uid).delete();
});

//Run on call, retrieves asked user's data.
exports.getUserData = functions.https.onCall(async (data, context) => {
    return await admin.firestore().collection('users').doc(data.uid).get()
    .then((doc) => {
        const retrievedData = doc.data();
        if (data.uid == context.auth.uid ) {
            return retrievedData;
        } else {
            return {
                //En caso de ser un retriever ajeno, sólo devuelve datos no sensibles.
                email: retrievedData.email,
                isVendor: retrievedData.isVendor,
                contributedTrees: retrievedData.contributedTrees
            }
        }
    });
});

exports.createTransaction = functions.https.onCall( async (data, context) => {
    //Receives target UID and transaction amount.
    const usersRef = admin.firestore().collection('users');

    async function getData (uid) {
        return await usersRef.doc(uid).get()
        .then(doc => {
            const retrievedData = doc.data();
            return {
                balance: retrievedData.balance,
                isVendor: retrievedData.isVendor
            }
        });
    }

    let originUser = await getData(context.auth.uid);

    if (originUser.balance < data.amount) return {status: 'Error', code: 500, message: 'Insufficient balance.'};
    
    let targetUser = await getData(data.uid);

    let fee = 0;
    let treeAmount = 0;

    if (targetUser.isVendor) {
        fee = data.amount * 0.02;
        targetUser.balance += parseInt(data.amount) - fee;
        treeAmount = data.amount / 1000;
    } else {
        targetUser.balance += parseInt(data.amount); //Somewhy data.amount is a string now? So got to parse it to INT. A ARREGLAR.
    }

    let originRef = usersRef.doc(context.auth.uid);
    let targetRef = usersRef.doc(data.uid);
    let leafRef = usersRef.doc('dtdAiM9nChcNdyR1a9NpC1e54Ag2');
    let plantRef = admin.firestore().collection('plantationData').doc('globalTrees');
    let regRef = admin.firestore().collection('transactions').doc();

    //COMIENZO DE TRANSACTION
    const batch = admin.firestore().batch();

    batch.update(originRef, {
        balance: admin.firestore.FieldValue.increment(-1 * data.amount),
        contributedTrees: admin.firestore.FieldValue.increment(treeAmount)
    });

    batch.update(targetRef, {
        balance: targetUser.balance
    });

    //Agrega la comisión a la cuenta Admin de Leaf.
    batch.update(leafRef, {
        balance: admin.firestore.FieldValue.increment(fee)
    });

    batch.update(plantRef, {
        willPlant: admin.firestore.FieldValue.increment(treeAmount)
    });

    data.amount = parseInt(data.amount); //A INVESTIGAR PORQUÉ SE HACE STRING
    batch.set(regRef, {
        idOrigin: context.auth.uid,
        idTarget: data.uid,
        amount: data.amount,
        fee: fee,
        treeAmount: treeAmount,
        commited: null,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    });

    // FIN DE TRANSACTION
    await batch.commit();

    return {status: 'Ok', code: 200, message: 'Transaction completed.'};
});

//Al crear un nuevo evento de plantación, la siguiente función actualiza los árboles plantados totales.
exports.plantationEvent = functions.firestore.document('plantationEvent/{plantationId}').onCreate( async (snap) => {
    const transactionsRef = admin.firestore().collection('transactions');
    const ignoredTrees = 1; //Arboles ignorados en el proceso de commiteo de transacciones.
    const batchSize = 10; //Cantidad de transacciones solicitadas en cada batch
    const plantationEvent = await snap.data();
    const location = plantationEvent.location;
    let plantedTrees = plantationEvent.plantedTrees;
    
    const query = await transactionsRef
    .where('commited', '==', false)
    .orderBy('timestamp', "asc")
    .limit(batchSize)
    .get();
    
    while(plantedTrees > ignoredTrees) {
        query.forEach((doc) => {
            const data = doc.data();
            if (plantedTrees >= data.treeAmount) {
                transactionsRef.doc(doc.id).update({
                    commited: location
                });
                plantedTrees -= data.treeAmount;
            }
        });
    }

    return admin.firestore().collection('plantationData').doc('globalTrees').update({
        didPlant: admin.firestore.FieldValue.increment(plantationEvent.plantedTrees - plantedTrees)
    });
});


exports.alikeUsernames = functions.https.onCall(async (data) => {
    const usersRef = admin.firestore().collection('users');

    const query = await usersRef
    .orderBy('email')
    .startAt(data.emailStr)
    .endAt(data.emailStr + '\uf8ff')
    .limit(data.limit)
    .get();

    let alikeUsernames = [];

    query.forEach((doc) => {
        const data = doc.data();
        alikeUsernames.push({
            email: data.email,
            uid: doc.id,
            isVendor: data.isVendor
        });
    });

    return alikeUsernames;
});