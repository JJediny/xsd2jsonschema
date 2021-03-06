"use strict";

const XsdFile = require('./xmlschema/xsdFileXmlDom');
const XsdAttributes = require('./xmlschema/xsdAttributes');
const XsdAttributeValues = require('./xmlschema/xsdAttributeValues');
const XsdNodeTypes = require('./xmlschema/xsdNodeTypes');
const SpecialCases = require('./specialCases');
const JsonSchemaFile = require("./jsonschema/jsonSchemaFile");

const specialCases_NAME = Symbol();

/**
 * Class representing a collection of logic to identify special cases in XML Schema that cannot be immediately
 * converted to JSON Schmea without inspecting the contents of the tag or the tag's siblings.  Examples:
 * 
 * 1. A <choice> where the goal is really anyOf.  For example:
 * 			<xs:choice>
 *				<xs:sequence>
 *					<xs:element name="DemandingPartyInfo" type="DemandingPartyInfoType"/>
 *					<xs:element name="ResponsiblePartyInfo" type="DemandingPartyInfoType" minOccurs="0"/>
 *					<xs:element name="ArbitrationDecisionInfo" type="DemandingPartyInfoType" minOccurs="0"/>
 *  			</xs:sequence>
 *				<xs:sequence>
 *					<xs:element name="ResponsiblePartyInfo" type="DemandingPartyInfoType"/>
 *					<xs:element name="ArbitrationDecisionInfo" type="DemandingPartyInfoType" minOccurs="0"/>
 *				</xs:sequence>
 *				<xs:element name="ArbitrationDecisionInfo" type="DemandingPartyInfoType"/>
 *			</xs:choice>
 * 2. Sibling <choice>
 * 3. Need a solution for optional <sequence>, <choice>, etc.  Currently just using an empty schema {} as an option.
 *
 * 
 * @see {@link ParsingState}
 */
class BaseSpecialCaseIdentifier {

    constructor() {
        this.specialCases = [];
    }

	get specialCases() {
		return this[specialCases_NAME];
	}
	set specialCases(newSpecialCase) {
		this[specialCases_NAME] = newSpecialCase;
	}

    addSpecialCase(specialCase, jsonschema) {
        this.specialCases.push({
            'specialCase': specialCase,
            'jsonSchema': jsonschema
        });
    }

    isOptionalSequence(node, xsd) {
        var retval = false;
        return retval;
    }

    isOptionalChoice(node, xsd) {
        var retval = false;
        return retval;
    }

    isSiblingChoice(node, xsd) {
        var retval = false;
        return retval;
    }

    countNonTextNodes(nodelist) {
        var count = 0;

        for (let i = 0; i < nodelist.length; i++) {
            if (nodelist.item(i).nodeType != 3) {
                count++;
            }
        }
        return count;
    }

    locateNewNameType(nameTypes, childrenOfOneOfTheChoiceOptions) {
        for (let nt = 0; nt < nameTypes.length; nt++) {
            for (let c = 0; c < childrenOfOneOfTheChoiceOptions.length; c++) {
                const node = childrenOfOneOfTheChoiceOptions[c];
                const name = XsdFile.getAttrValue(node, XsdAttributes.NAME);
                const type = XsdFile.getAttrValue(node, XsdAttributes.TYPE);
                const minOccurs = XsdFile.getAttrValue(node, XsdAttributes.MIN_OCCURS);
                if (nameTypes[nt].name != name &&
                    minOccurs == undefined) {
                    return {
                        'name': name,
                        'type': type
                    }
                }
            }
        }
        return undefined;
    }

    verifyPriorChoices(nameTypes, childrenOfOneOfTheChoiceOptions) {
        for (let nt = 0; nt < nameTypes.length; nt++) {
            let optionalPriorNameTypeFound = false;
            for (let c = 0; c < childrenOfOneOfTheChoiceOptions.length; c++) {
                const node = childrenOfOneOfTheChoiceOptions[c];
                const name = XsdFile.getAttrValue(node, XsdAttributes.NAME);
                const type = XsdFile.getAttrValue(node, XsdAttributes.TYPE);
                const minOccurs = XsdFile.getAttrValue(node, XsdAttributes.MIN_OCCURS);
                if (nameTypes[nt].name === name &&
                    nameTypes[nt].type === type &&
                    minOccurs === XsdAttributeValues.ZERO) {
                    optionalPriorNameTypeFound = true;
                }
            }
            if (!optionalPriorNameTypeFound) {
                return false;
            }
        }
        return true;
    }

    checkNode(nameTypes, nextChoiceOption, expectedChildCount) {
        var retval;
        const children = this.nodeListToArray(nextChoiceOption.childNodes);
        const actualChildCount = children.length;
        if (actualChildCount == expectedChildCount && this.verifyPriorChoices(nameTypes, children)) {
            retval = this.locateNewNameType(nameTypes, children)
        }
        return retval;
    }

    isOptionallyIncremental(nameTypes, sortedChoiceChildren, index) {
        if (index == sortedChoiceChildren.length) {
            return true;
        }
        const node = sortedChoiceChildren[index];
        const checkNameType = this.checkNode(nameTypes, node, index + 1);
        if (checkNameType != undefined) {
            nameTypes.push(checkNameType);
            return this.isOptionallyIncremental(nameTypes, sortedChoiceChildren, index + 1);
        } else {
            return false;
        }
    }

    nodeListToArray(nodelist) {
        var array = [];
        for (let i = 0; i < nodelist.length; i++) {
            if (nodelist.item(i).nodeType != XsdNodeTypes.TEXT_NODE) {
                array.push(nodelist.item(i));
            }
        }
        return array;
    }

    isAnyOfChoice(node, xsd) {
        var retval = false;
        if (node.hasChildNodes() && node.childNodes.length > 1) {
            var sortedChildren = this.nodeListToArray(node.childNodes).sort((a, b) => {
                const aHasNodes = a.hasChildNodes();
                const bHasNodes = b.hasChildNodes();
                var aNodeCount = 0;
                var bNodeCount = 0;
                if (aHasNodes) {
                    aNodeCount = a.childNodes.length
                }
                if (bHasNodes) {
                    bNodeCount = b.childNodes.length
                }
                if (aNodeCount < bNodeCount) {
                    return -1;
                } else if (aNodeCount > bNodeCount) {
                    return 1;
                } else {
                    return 0
                }
            });
            const firstChild = sortedChildren[0];
            if (XsdFile.hasAttribute(firstChild, XsdAttributes.NAME) && XsdFile.hasAttribute(firstChild, XsdAttributes.TYPE)) {
                var nameTypes = [ {} ];
                nameTypes[0].name = XsdFile.getAttrValue(firstChild, XsdAttributes.NAME);
                nameTypes[0].type = XsdFile.getAttrValue(firstChild, XsdAttributes.TYPE);
                retval = this.isOptionallyIncremental(nameTypes, sortedChildren, 1);
            }
        }
        return retval;
    }

    fixAnyOfChoice(jsonSchema) {

        if (jsonSchema.oneOf.length == 0) {
            return;
        }
        //console.log("BEFORE\n" + JSON.stringify(jsonSchema.getJsonSchema(), null, 2));

        var anyOf = jsonSchema.oneOf[0];
        anyOf.required.length = 0;
		Object.keys(anyOf.properties).forEach(function (prop, index, array) {
			//console.log(prop + "=" + anyOf.properties[prop]);
            const newAnyOf = new JsonSchemaFile({});
            newAnyOf.setProperty(prop, anyOf.properties[prop]);
            jsonSchema.anyOf.push(newAnyOf);
		});
        jsonSchema.oneOf.length = 0;

        //console.log("AFTER\n" + JSON.stringify(jsonSchema.getJsonSchema(), null, 2));
    }

}

module.exports = BaseSpecialCaseIdentifier;