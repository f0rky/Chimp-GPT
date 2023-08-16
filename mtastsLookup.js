const dns = require('dns').promises;
const https = require('https');

async function fetchMTASTSPolicy(domain) {
    return new Promise((resolve, reject) => {
        https.get(`https://mta-sts.${domain}/.well-known/mta-sts.txt`, (res) => {
            let data = '';
            res.on('data', chunk => {
                data += chunk;
            });
            res.on('end', () => {
                resolve(data);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

async function validateMTASTSRecord(domain) {
    try {
        const result = {
            "MTA-STS record details": {
                "Address": `_mta-sts.${domain}`,
                "Domain": domain,
                "Record": "",
                "Version": "",
                "ID": "",
                "MTA-STS mode": "",
                "Inspection result": ""
            },
            "MTA-STS policy details": {
                "Address": `https://mta-sts.${domain}/.well-known/mta-sts.txt`,
                "Domain": domain,
                "Policy server": "",
                "HTTP response code": "",
                "Policy (raw)": "",
                "Version": "",
                "Mode": "",
                "Max age": "",
                "MX": ""
            }
        };

        // Lookup TXT records for the domain
        const txtRecords = await dns.resolveTxt('_mta-sts.' + domain);
        const mtastsRecord = txtRecords.find(record => record[0].startsWith('v=STSv1'));

        if (!mtastsRecord) {
            result["MTA-STS record details"]["Inspection result"] = "MTA-STS record not found";
            return result;
        }

        result["MTA-STS record details"]["Record"] = mtastsRecord[0];
        const versionMatch = mtastsRecord[0].match(/v=(STSv\d+)/);
        const idMatch = mtastsRecord[0].match(/id=([^;]+)/);

        if (versionMatch) result["MTA-STS record details"]["Version"] = versionMatch[1];
        if (idMatch) result["MTA-STS record details"]["ID"] = idMatch[1];

        const mtaStsPolicy = await fetchMTASTSPolicy(domain);
        if (!mtaStsPolicy) {
            result["MTA-STS policy details"]["HTTP response code"] = "Failed fetching MTA-STS policy";
            return result;
        }

        result["MTA-STS policy details"]["Policy (raw)"] = mtaStsPolicy;

        const policyVersionMatch = mtaStsPolicy.match(/version:\s*(STSv\d+)/);
        const policyModeMatch = mtaStsPolicy.match(/mode:\s*(none|testing|enforce)/);
        const policyMaxAgeMatch = mtaStsPolicy.match(/max_age:\s*(\d+)/);
        const policyMXMatch = mtaStsPolicy.match(/mx:\s*([^;\n]+)/);

        if (policyVersionMatch) result["MTA-STS policy details"]["Version"] = policyVersionMatch[1];
        if (policyModeMatch) result["MTA-STS policy details"]["Mode"] = policyModeMatch[1];
        if (policyMaxAgeMatch) result["MTA-STS policy details"]["Max age"] = `${policyMaxAgeMatch[1]} seconds`;
        if (policyMXMatch) result["MTA-STS policy details"]["MX"] = policyMXMatch[1];

        result["MTA-STS record details"]["Inspection result"] = "Record is valid";
        return result;
    } catch (error) {
        return {
            "MTA-STS record details": {
                "Inspection result": "DNS lookup failed"
            }
        };
    }
}

async function main() {
    // Use the domain provided from the command line, or fall back to 'b3tech.nz'
    const domain = process.argv[2] || 'b3tech.nz';

    try {
        const result = await validateMTASTSRecord(domain);
        console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        console.error(error);
    }
}

// Check if the script is being run directly (not imported)
if (require.main === module) {
    main();
}
