// 필요한 라이브러리
const fs = require('fs');
const yaml = require('yaml');
const axios = require('axios');

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

// 메인 함수
async function runTest(configPath) {
    // 1. YAML 읽기
    const configFile = fs.readFileSync(configPath, 'utf8');
    const config = yaml.parse(configFile);

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
                console.log(`\n  [URL - A] ${urlA}`);
                console.log(`  [URL - B] ${urlB}`);
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
                console.log(`\n  [Headers - A] ${JSON.stringify(headersA, null, 2)}`);
                console.log(`  [Headers - B] ${JSON.stringify(headersB, null, 2)}`);
                // 4. API 호출
                const [responseA, responseB] = await Promise.all([
                    axios({ method, url: urlA, headers: headersA }).then(res => res.data),
                    axios({ method, url: urlB, headers: headersB }).then(res => res.data)
                ]);

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

                // 6. 비교
                if (deepEqual(dataA, dataB)) {
                    console.log('    ✅ PASS');
                } else {
                    console.log('    ❌ FAIL');
                    console.log('    [A] ', JSON.stringify(dataA, null, 2));
                    console.log('    [B] ', JSON.stringify(dataB, null, 2));
                }
            } catch (err) {
                console.error('    🚨 Error:', err.message);
            }
        }
    }
}

// 유틸 함수: 객체의 키를 모두 소문자로 변환
// function toLowerCaseKeys(obj) {
//     if (Array.isArray(obj)) {
//         return obj.map(item => toLowerCaseKeys(item));
//     } else if (obj !== null && typeof obj === 'object') {
//         const newObj = {};
//         for (const [key, value] of Object.entries(obj)) {
//             const newKey = key.toLowerCase().replace(/_/g, '');
//             newObj[newKey] = toLowerCaseKeys(value);
//         }
//         return newObj;
//     }
//     return obj;
// }

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

// 실행
const configPath = './test.yaml'; // 사용할 YAML 경로
runTest(configPath);