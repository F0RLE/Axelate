const fs = require('node:fs');

try {
    const rawData = fs.readFileSync('lint-results-final.json', 'utf8');
    const results = JSON.parse(rawData);

    let totalErrors = 0;
    let totalWarnings = 0;
    const fileErrors = [];
    const ruleCounts = {};

    results.forEach(result => {
        totalErrors += result.errorCount;
        totalWarnings += result.warningCount;
        
        if (result.errorCount > 0) {
            fileErrors.push({
                filePath: result.filePath,
                errorCount: result.errorCount,
                messages: result.messages.filter(m => m.severity === 2).slice(0, 3) // Top 3 errors per file
            });
            
            result.messages.forEach(msg => {
                if (msg.severity === 2) {
                    ruleCounts[msg.ruleId] = (ruleCounts[msg.ruleId] || 0) + 1;
                }
            });
        }
    });

    console.log(`Total Errors: ${totalErrors}`);
    console.log(`Total Warnings: ${totalWarnings}`);
    console.log('\nTop Rules Violated:');
    Object.entries(ruleCounts)
        .sort(([,a], [,b]) => b - a)
        .slice(0, 10)
        .forEach(([rule, count]) => console.log(`${rule}: ${count}`));

    console.log('\nTop 5 Files with Errors:');
    fileErrors.toSorted((a, b) => b.errorCount - a.errorCount).slice(0, 5).forEach(f => {
        console.log(`${f.filePath} (${f.errorCount} errors)`);
        f.messages.forEach(m => console.log(`  - ${m.ruleId}: ${m.message} (Line ${m.line})`));
    });

} catch (err) {
    console.error('Error parsing lint results:', err);
}
