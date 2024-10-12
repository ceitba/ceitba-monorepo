import fetch from 'node-fetch';
import { writeFileSync } from 'fs';
import { parse } from 'json2csv';

const apiUrl = 'http://localhost:3000/api/v1/itba/subjects';

async function fetchSubjects() {
    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const subjects = await response.json();
        return subjects;
    } catch (error) {
        console.error('Error fetching subjects:', error);
        return [];
    }
}

async function createCSV() {
    const subjects = await fetchSubjects();
    if (subjects.length === 0) {
        console.log('No subjects to write to CSV.');
        return;
    }

    const csv = parse(subjects);
    writeFileSync('subjects.csv', csv);
    console.log('CSV file created successfully.');
}

createCSV();