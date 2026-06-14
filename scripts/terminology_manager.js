#!/usr/bin/env node
/**
 * Diamond Terminology Manager
 * Multi-language glossary for professional communication
 */

class TerminologyManager {
  constructor() {
    this.glossary = this.loadGlossary();
  }

  loadGlossary() {
    return {
      shapes: {
        en: { RBC: 'Round Brilliant', PR: 'Princess', EM: 'Emerald', PS: 'Pear', OV: 'Oval', CU: 'Cushion', RAD: 'Radiant', HS: 'Heart', MQ: 'Marquise' },
        'zh-CN': { RBC: '圓形明亮式', PR: '公主方', EM: '祖母绿形', PS: '梨形', OV: '椭圓形', CU: '枕形', RAD: '雷地恩形', HS: '心形', MQ: '马眼形' },
        'zh-HK': { RBC: '圓鑽', PR: '公主方', EM: '祖母綠形', PS: '梨形', OV: '橢圓形', CU: '枕形', RAD: '雷地恩形', HS: '心形', MQ: '馬眼形' }
      },
      colors: {
        en: { D: 'Colorless', E: 'Colorless', F: 'Colorless', G: 'Near Colorless', H: 'Near Colorless', I: 'Near Colorless', J: 'Near Colorless' },
        'zh-CN': { D: '無色', E: '無色', F: '無色', G: '接近無色', H: '接近無色', I: '接近無色', J: '接近無色' },
        'zh-HK': { D: '無色', E: '無色', F: '無色', G: '接近無色', H: '接近無色', I: '接近無色', J: '接近無色' }
      },
      clarities: {
        en: { FL: 'Flawless', IF: 'Internally Flawless', VVS1: 'Very Very Slightly Included', VVS2: 'Very Very Slightly Included', VS1: 'Very Slightly Included', VS2: 'Very Slightly Included', SI1: 'Slightly Included', SI2: 'Slightly Included' },
        'zh-CN': { FL: '無瑕', IF: '內部無瑕', VVS1: '极轻微瑕', VVS2: '极轻微瑕', VS1: '轻微瑕', VS2: '轻微瑕', SI1: '小瑕', SI2: '小瑕' },
        'zh-HK': { FL: '無瑕', IF: '內部無瑕', VVS1: '極輕微瑕', VVS2: '極輕微瑕', VS1: '輕微瑕', VS2: '輕微瑕', SI1: '小瑕', SI2: '小瑕' }
      },
      cut: {
        en: { EX: 'Excellent', VG: 'Very Good', G: 'Good', F: 'Fair', P: 'Poor' },
        'zh-CN': { EX: '极优', VG: '很好', G: '好', F: '一般', P: '差' },
        'zh-HK': { EX: '極優', VG: '很好', G: '好', F: '一般', P: '差' }
      },
      fluorescence: {
        en: { N: 'None', F: 'Faint', M: 'Medium', S: 'Strong', VS: 'Very Strong' },
        'zh-CN': { N: '無', F: '轻微', M: '中等', S: '强', VS: '很强' },
        'zh-HK': { N: '無', F: '輕微', M: '中等', S: '強', VS: '很強' }
      }
    };
  }

  translate(term, category, targetLang = 'en') {
    const categoryData = this.glossary[category];
    if (!categoryData) return term;

    const translations = categoryData[targetLang] || categoryData.en;
    return translations[term] || term;
  }

  translateDiamond(diamond, lang) {
    return {
      shape: this.translate(diamond.shape, 'shapes', lang),
      color: this.translate(diamond.color, 'colors', lang),
      clarity: this.translate(diamond.clarity, 'clarities', lang),
      cut: diamond.cut ? this.translate(diamond.cut, 'cut', lang) : null,
      polish: diamond.polish ? this.translate(diamond.polish, 'cut', lang) : null,
      symmetry: diamond.symmetry ? this.translate(diamond.symmetry, 'cut', lang) : null,
      fluorescence: diamond.fluorescence ? this.translate(diamond.fluorescence, 'fluorescence', lang) : null
    };
  }

  getAllTerms(category) {
    return this.glossary[category] || {};
  }
}

module.exports = TerminologyManager;
