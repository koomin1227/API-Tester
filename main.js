// 필요한 라이브러리
const fs = require('fs');
const yaml = require('yaml');
const axios = require('axios');
const {parseConfig} = require("./services/configParser");

// 유틸 함수: path param 채워넣기
function fillPath(path, params) {
    if (!params) return path;
    Object.entries(params).forEach(([key, value]) => {
        path = path.replace(`:${key}`, encodeURIComponent(value));
    });
    return path;
}

// 유틸 함수: query param 붙이기
function buildQuery(params) {
    if (!params || Object.keys(params).length === 0) return '';
    const query = new URLSearchParams(params).toString();
    return `?${query}`;
}

function isEmptyObject(obj) {
    return obj && Object.keys(obj).length === 0 && obj.constructor === Object;
}

// 유틸 함수: 필드 매핑 적용
// Todo 지금은 path 가 정확히 맞는 부분만 변경하지만, 추가로 옵션을 두어 해당 path 아래에 있는 것 모두 변경 가능하는 옵션 필요
function applyFieldMappings(obj, fieldMappings, currentPath = '') {
    if (isEmptyObject(fieldMappings)) {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map((item, index) => applyFieldMappings(item, fieldMappings, currentPath));
    } else if (obj !== null && typeof obj === 'object') {
        const applicableMapping = fieldMappings.find(fm => fm.path === currentPath);

        const mapped = {};
        for (const [key, value] of Object.entries(obj)) {
            const newKey = applicableMapping?.mappings[key] || key;
            const nextPath = currentPath ? `${currentPath}.${newKey}` : newKey;
            mapped[newKey] = applyFieldMappings(value, fieldMappings, nextPath);
        }
        return mapped;
    }
    return obj;
}

// 유틸 함수: 필드 무시 적용
function removeIgnoredFields(obj, ignoreFields, ignoreCase) {
    if (Array.isArray(obj)) {
        return obj.map(item => removeIgnoredFields(item, ignoreFields, ignoreCase));
    } else if (obj !== null && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            const shouldIgnore = ignoreFields.some((field) => {
                if (ignoreCase) {
                    return field.toLowerCase() === key.toLowerCase();
                }
                return field === key;
            });
            if (!shouldIgnore) {
                result[key] = removeIgnoredFields(value, ignoreFields, ignoreCase);
            }
        }
        return result;
    }
    return obj;
}

// 유틸 함수: 객체 비교
function deepEqual(objA, objB) {
    return JSON.stringify(objA) === JSON.stringify(objB);
}

function diffObjects(objA, objB, path = '') {
    const diffs = [];

    if (typeof objA !== typeof objB) {
        diffs.push({ path, valueA: objA, valueB: objB });
        return diffs;
    }

    if (typeof objA !== 'object' || objA === null || objB === null) {
        if (objA !== objB) {
            diffs.push({ path, valueA: objA, valueB: objB });
        }
        return diffs;
    }

    const keys = new Set([...Object.keys(objA || {}), ...Object.keys(objB || {})]);
    for (const key of keys) {
        const nextPath = path ? `${path}.${key}` : key;
        diffs.push(...diffObjects(objA?.[key], objB?.[key], nextPath));
    }

    return diffs;
}


// 메인 함수
async function runTest(configPath, options) {
    isDebug = options.debug !== undefined;
    resultPrint = options.print !== undefined;

    // 1. YAML 읽기
    const config = parseConfig(configPath);
    const { ignoreCase, baseA, baseB, tests } = config;

    for (const test of tests) {
        console.log(`\n[TEST] ${test.name}`);

        let { method, apiA, apiB, ignoreFields = [], fieldMappings = {}, cases = [] } = test;

        for (const testCase of cases) {
            console.log(`\n  [CASE] ${testCase.name}`);

            try {
                // 2. URL 완성
                const urlA = baseA.url + fillPath(apiA.path, testCase.apiA?.pathParams) + buildQuery(testCase.apiA?.queryParams);
                const urlB = baseB.url + fillPath(apiB.path, testCase.apiB?.pathParams) + buildQuery(testCase.apiB?.queryParams);

                // 3. 헤더 합치기 (base + 추가)
                const headersA = {
                    ...baseA.headers,
                    ...apiA.headers,
                    ...(testCase.apiA?.headers || {})
                };
                const headersB = {
                    ...baseB.headers,
                    ...apiB.headers,
                    ...(testCase.apiB?.headers || {})
                };

                printDebugInfo({urlA, urlB}, {headersA, headersB}, isDebug)

                // 4. API 호출
                const [responseA, responseB] = await Promise.all([
                    axios({ method, url: urlA, headers: headersA }).then(res => res.data),
                    axios({ method, url: urlB, headers: headersB }).then(res => res.data)
                ]);
                printResult(responseA, responseB, resultPrint);

                // 5. 응답 처리
                let dataA = responseA;
                let dataB = responseB;

                // Case insensitive 처리 (옵션)
                if (ignoreCase) {
                    dataA = toLowerCaseKeys(dataA);
                    dataB = toLowerCaseKeys(dataB);
                    fieldMappings = toLowerCaseKeys(fieldMappings, true);
                    ignoreFields = toLowerCaseKeys(ignoreFields);
                }

                // 필드 매핑 적용 (A 기준으로 변경)
                dataA = applyFieldMappings(dataA, fieldMappings);

                // 필드 무시 적용
                dataA = removeIgnoredFields(dataA, ignoreFields, ignoreCase);
                dataB = removeIgnoredFields(dataB, ignoreFields, ignoreCase);


                const diffs = diffObjects(dataA, dataB);

                if (diffs.length === 0) {
                    console.log('    ✅ PASS');
                } else {
                    console.log('    ❌ FAIL');
                    for (const diff of diffs) {
                        console.log(`    [DIFF] ${diff.path}`);
                        console.log(`      A: ${JSON.stringify(diff.valueA)}`);
                        console.log(`      B: ${JSON.stringify(diff.valueB)}`);
                    }
                }
            } catch (err) {
                console.error('    🚨 Error:', err.message);
            }
        }
    }
}

function toLowerCaseKeys(obj, convertValues = false) {
    if (Array.isArray(obj)) {
        return obj.map(item => toLowerCaseKeys(item, convertValues));
    } else if (obj !== null && typeof obj === 'object') {
        const newObj = {};
        for (const [key, value] of Object.entries(obj)) {
            const newKey = key.toLowerCase().replace(/_/g, '');
            newObj[newKey] = toLowerCaseKeys(value, convertValues);
        }
        return newObj;
    } else {
        if (convertValues && typeof obj === 'string') {
            return obj.toLowerCase();
        }
        return obj;
    }
}

function printDebugInfo(urls, headers, isDebug) {
    if (!isDebug) return;
    const {urlA, urlB} = urls;
    const {headersA, headersB} = headers;

    console.log(`\n  [URL - A] ${urlA}`);
    console.log(`  [URL - B] ${urlB}`);

    console.log(`\n  [Headers - A] ${JSON.stringify(headersA, null, 2)}`);
    console.log(`  [Headers - B] ${JSON.stringify(headersB, null, 2)}`);
}

function printResult(responseA, responseB, resultPrint) {
    if (!resultPrint) return;
    console.log('\n  [Response - A]');
    console.log(JSON.stringify(responseA, null, 2));

    console.log('\n  [Response - B]');
    console.log(JSON.stringify(responseB, null, 2));
}

// 실행
const configPath = './test.yaml'; // 사용할 YAML 경로
// runTest(configPath);



module.exports = {
    runTest
};