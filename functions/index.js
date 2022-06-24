const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

//Run when a user is created in FirebaseAuth, creates his profile in Firestore.
exports.createProfile = functions.auth.user().onCreate((user) => {
    return admin.firestore().collection('users').doc(user.uid).set({
        email: user.email,
        balance: 0, 
        plantedTrees: 0,
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
    console.log(context.auth.uid);
    return await admin.firestore().collection('users').doc(data.uid).get()
    .then((doc) => {
        const retrievedData = doc.data();

        if (data.uid == context.auth.uid ) {
            return retrievedData;
        } else {
            return {
                email: retrievedData.email,
                isVendor: retrievedData.isVendor,
                plantedTrees: retrievedData.plantedTrees
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
                isVendor: retrievedData.isVendor,
                plantedTrees: retrievedData.plantedTrees
            }
        });
    }

    let originUser = await getData(context.auth.uid);

    if (originUser.balance < data.amount) return {status: 'Error', code: 500, message: 'Insufficient balance.'};
    
    let targetUser = await getData(data.uid);

    let fee = 0;

    originUser.balance -= data.amount;

    if (targetUser.isVendor) {
        targetUser.balance += parseInt(data.amount) * 0.98;
        originUser.plantedTrees += data.amount / 1000;
        fee = data.amount * 0.02;
    } else {
        targetUser.balance += parseInt(data.amount); //Somewhy data.amount is a string now? So got to parse it to INT. A ARREGLAR.
    }

    let originRef = usersRef.doc(context.auth.uid);
    let targetRef = usersRef.doc(data.uid);
    let regRef = admin.firestore().collection('transactions').doc();

    //COMIENZO DE TRANSACTION
    const batch = admin.firestore().batch();

    batch.update(originRef, {
        balance: originUser.balance,
        plantedTrees: originUser.plantedTrees
    });

    batch.update(targetRef, {
        balance: targetUser.balance
    });

    batch.set(regRef, {
        idOrigin: context.auth.uid,
        idTarget: data.uid,
        amount: data.amount,
        fee: fee
    });

    // FIN DE TRANSACTION
    await batch.commit();

    return {status: 'Ok', code: 200, message: 'Transaction completed.'};
});

/*exports.alikeUsernames = functions.https.onCall(async (data) => {
    const usersRef = admin.firestore().collection('users');

    usersRef.orderBy('email').startAt(name).endAt(name+'\uf8ff')
});*/