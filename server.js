const express = require('express');
const app = express();

app.use(express.json());
app.use(express.static('public'));

app.use('/api/lasten', require('./routes/lasten'));
app.use('/api/periodes', require('./routes/periodes'));
app.use('/api/import', require('./routes/import'));
app.use('/api/statistieken', require('./routes/statistieken'));
app.use('/api/instellingen', require('./routes/instellingen'));
app.use('/api/transacties', require('./routes/transacties'));

const PORT = 3001;
app.listen(PORT, () => console.log(`Vaste lasten app draait op http://localhost:${PORT}`));
